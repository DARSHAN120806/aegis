#!/usr/bin/env python3
"""Provision a private versioned S3 bucket with TLS-only access; run using object admin credentials."""
import json
from app.adapters import storage
from app.config import settings

c=settings()
s=storage()
try:
    s.head_bucket(Bucket=c.s3_bucket)
except s.exceptions.ClientError as error:
    if error.response['Error']['Code'] not in {'404','NoSuchBucket','NotFound'}:
        raise
    options={} if c.s3_region=='us-east-1' else {'CreateBucketConfiguration':{'LocationConstraint':c.s3_region}}
    s.create_bucket(Bucket=c.s3_bucket,**options)
s.put_public_access_block(Bucket=c.s3_bucket,PublicAccessBlockConfiguration={
    'BlockPublicAcls':True,'IgnorePublicAcls':True,'BlockPublicPolicy':True,'RestrictPublicBuckets':True})
s.put_bucket_versioning(Bucket=c.s3_bucket,VersioningConfiguration={'Status':'Enabled'})
s.put_bucket_encryption(Bucket=c.s3_bucket,ServerSideEncryptionConfiguration={'Rules':[{
    'ApplyServerSideEncryptionByDefault':{'SSEAlgorithm':'aws:kms','KMSMasterKeyID':c.s3_kms_key}}]})
s.put_bucket_policy(Bucket=c.s3_bucket,Policy=json.dumps({'Version':'2012-10-17','Statement':[{
    'Sid':'DenyPlaintext','Effect':'Deny','Principal':'*','Action':'s3:*',
    'Resource':[f'arn:aws:s3:::{c.s3_bucket}',f'arn:aws:s3:::{c.s3_bucket}/*'],
    'Condition':{'Bool':{'aws:SecureTransport':'false'}}}]}))
print('Private bucket versioning, TLS policy and KMS encryption configured')
