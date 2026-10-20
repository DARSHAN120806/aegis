#!/usr/bin/env python3
"""Exercise the Compose integration profile using real PostgreSQL, Redis and S3 APIs."""
import os
import sys
import uuid
from pathlib import Path

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'backend'))
from dotenv import load_dotenv
load_dotenv(root/'.env')
import boto3
import redis
from sqlalchemy import create_engine,text
from botocore.config import Config

postgres=os.environ.get('AEGIS_TEST_POSTGRES')
redis_url=os.environ.get('AEGIS_TEST_REDIS')
s3_url=os.environ.get('AEGIS_TEST_S3')
if not all([postgres,redis_url,s3_url]):
    raise SystemExit('Set AEGIS_TEST_POSTGRES, AEGIS_TEST_REDIS and AEGIS_TEST_S3 to isolated integration services; no demo fallback')
engine=create_engine(postgres)
name='probe_'+uuid.uuid4().hex
with engine.begin() as db:
    db.execute(text(f'CREATE TABLE {name} (id INTEGER PRIMARY KEY, value TEXT NOT NULL)'))
    db.execute(text(f'INSERT INTO {name} VALUES (1,:v)'),{'v':'durable'})
with engine.connect() as db:
    assert db.execute(text(f'SELECT value FROM {name} WHERE id=1')).scalar_one()=='durable'
with engine.begin() as db:
    db.execute(text(f'DROP TABLE {name}'))
cache=redis.Redis.from_url(redis_url,decode_responses=True,socket_timeout=5)
key='aegis:integration:'+uuid.uuid4().hex
assert cache.set(key,'nonce',ex=30,nx=True)
assert cache.getdel(key)=='nonce'
assert cache.getdel(key) is None
client=boto3.client('s3',endpoint_url=s3_url,aws_access_key_id=os.environ['MINIO_ROOT_USER'],
                    aws_secret_access_key=os.environ['MINIO_ROOT_PASSWORD'],region_name='us-east-1',
                    config=Config(signature_version='s3v4',connect_timeout=5,read_timeout=5))
bucket='aegis-integration-'+uuid.uuid4().hex
client.create_bucket(Bucket=bucket)
try:
    client.put_object(Bucket=bucket,Key='probe',Body=b'integrity')
    assert client.get_object(Bucket=bucket,Key='probe')['Body'].read()==b'integrity'
finally:
    client.delete_object(Bucket=bucket,Key='probe')
    client.delete_bucket(Bucket=bucket)
print('Actual PostgreSQL commit/read, Redis expiry/GETDEL and S3 put/get passed. This does not verify Fabric, production TLS, KMS or ClamAV.')
