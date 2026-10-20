#!/usr/bin/env python3
"""Resettable local simulation through the normal API, never direct data writes."""
import argparse
import json
import urllib.request
import urllib.error
import uuid
parser=argparse.ArgumentParser()
parser.add_argument("operation",choices=["reset","golden"])
parser.add_argument("--url",default="http://127.0.0.1:8000")
args=parser.parse_args()
def post(path,payload,token=None):
    request=urllib.request.Request(args.url+path,data=json.dumps(payload).encode(),headers={"Content-Type":"application/json","Idempotency-Key":str(uuid.uuid4()),**({"Authorization":"Bearer "+token} if token else {})})
    with urllib.request.urlopen(request) as response:return json.load(response)
def login(persona):return post('/api/demo/session',{'persona':persona})['access_token']
admin=login('admin')
post('/api/demo/reset',{},admin)
print('SIMULATION reset complete')
if args.operation=='golden':
    steps=[('admin','identity.create','did:aegis:alice',{}),('manager','credential.issue','demo-credential',{'owner':'did:aegis:alice','metadata_hash':'a'*64}),('manager','asset.mint','demo-asset',{'metadata_hash':'a'*64}),('manager','asset.assign','demo-asset',{'owner':'did:aegis:user'}),('user','asset.mint','forbidden',{'metadata_hash':'a'*64}),('user','asset.transfer.request','demo-asset',{'owner':'did:aegis:recipient'}),('manager','asset.transfer.approve','demo-asset',{}),('recipient','asset.transfer.accept','demo-asset',{})]
    for persona,action,subject,extra in steps:
        try:
            post('/api/commands',{'action':action,'subject':subject,**extra},login(persona))
            if subject=='forbidden':raise RuntimeError('Security failure: forbidden action succeeded')
            print(action+': completed')
        except urllib.error.HTTPError as error:
            if subject=='forbidden' and error.code==403:print(action+': blocked as expected')
            else:raise
    result=post('/api/assets/demo-asset/verify',{'metadata_hash':'a'*64},login('auditor'))
    if not result['valid']:raise RuntimeError('Verification failed')
    print('SIMULATION verification passed; inspect Provenance and Audit in UI')
