#!/usr/bin/env python3
"""Live production smoke: real authentication/dependencies/ledger; never starts or selects a mock."""
import argparse
import base64
import hashlib
import time
import uuid
from pathlib import Path

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

p=argparse.ArgumentParser()
p.add_argument('--url',required=True)
p.add_argument('--did',required=True)
p.add_argument('--key',required=True)
p.add_argument('--ca',required=True)
a=p.parse_args()
key=serialization.load_pem_private_key(Path(a.key).read_bytes(),password=None)
with httpx.Client(base_url=a.url,verify=a.ca,timeout=45) as client:
    ready=client.get('/health/ready');ready.raise_for_status()
    assert ready.json()['mode']=='production'
    challenge=client.post('/api/auth/challenge',json={'did':a.did});challenge.raise_for_status()
    challenge=challenge.json()
    proof=base64.b64encode(key.sign(challenge['message'].encode(),ec.ECDSA(hashes.SHA256()))).decode()
    login=client.post('/api/auth/session',json={'did':a.did,'challenge':challenge['challenge'],'signature':proof})
    login.raise_for_status()
    client.headers['Authorization']='Bearer '+login.json()['access_token']
    assert client.post('/api/auth/session',json={'did':a.did,'challenge':challenge['challenge'],'signature':proof}).status_code==401
    uid='smoke-'+str(uuid.uuid4())
    payload={'action':'asset.mint','subject':uid,'metadata_hash':hashlib.sha256(b'live integration').hexdigest()}
    idem=str(uuid.uuid4())
    result=client.post('/api/commands',json=payload,headers={'Idempotency-Key':idem});result.raise_for_status()
    assert result.status_code==202
    operation=result.json()['operation']
    replay=client.post('/api/commands',json=payload,headers={'Idempotency-Key':idem});replay.raise_for_status()
    assert replay.json()['operation']==operation
    for _ in range(90):
        result=client.get('/api/operations/'+operation);result.raise_for_status()
        status=result.json()['status']
        if status=='committed':break
        assert status not in {'invalid','attention','rejected'},result.json()
        time.sleep(2)
    else:raise RuntimeError('No confirmed/projected Fabric commit within 180 seconds')
    assert client.get('/api/records/asset',params={'q':uid}).json()[0]['id']==uid
    evidence=b'%PDF-1.7\nLive integration evidence\n%%EOF'
    result=client.post(f'/api/assets/{uid}/evidence',content=evidence,headers={'Content-Type':'application/pdf'})
    result.raise_for_status();eid=result.json()['id']
    evidence_operation=result.json()['operation']
    for _ in range(90):
        state=client.get('/api/operations/'+evidence_operation);state.raise_for_status()
        if state.json()['status']=='committed':break
        assert state.json()['status'] not in {'invalid','attention','rejected'}
        time.sleep(2)
    else:raise RuntimeError('Evidence did not anchor to Fabric')
    downloaded=client.get('/api/evidence/'+eid);downloaded.raise_for_status()
    assert downloaded.content==evidence
    assert downloaded.headers['x-evidence-sha256']==hashlib.sha256(evidence).hexdigest()
    client.post('/api/auth/logout').raise_for_status()
    assert client.get('/api/me').status_code==401
print('Live production readiness, certificate session, replay denial, idempotency, Fabric commit/projection, S3 byte integrity and logout passed')
