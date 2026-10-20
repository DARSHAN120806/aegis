#!/usr/bin/env python3
"""Run repository checks and preserve output with return codes. No success is inferred from file existence."""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
p.add_argument('--browser',action='store_true')
p.add_argument('--audit',action='store_true')
a=p.parse_args()
python=root/'.venv'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
if not python.exists():raise SystemExit('Install the locked environment first')
npm='npm.cmd' if os.name=='nt' else 'npm'
checks=[
 ('backend-lint',[str(python),'-m','ruff','check','app','tests'],root/'backend'),
 ('backend-format',[str(python),'-m','ruff','format','--check','app','tests'],root/'backend'),
 ('backend-tests',[str(python),'-m','pytest','-q','--tb=short'],root/'backend'),
 ('typescript-format',[npm,'run','format:check'],root/'frontend'),
 ('frontend-build',[npm,'run','build'],root/'frontend'),
 ('chaincode-build',[npm,'run','build'],root/'chaincode'),
 ('chaincode-tests',[npm,'test'],root/'chaincode'),
 ('fabric-bridge-syntax',[npm,'run','check'],root/'fabric-service'),
 ('fabric-bridge-tests',[npm,'test'],root/'fabric-service')]
if a.browser:checks.append(('browser-tests',[npm,'run','test:e2e'],root/'frontend'))
if a.audit:
 for directory in ['frontend','chaincode','fabric-service']:
  checks.append((directory+'-audit',[npm,'audit','--audit-level=high'],root/directory))
 checks.append(('python-audit',[str(python),'-m','pip_audit','-r','backend/requirements.lock'],root))
out=root/'docs'/'validation'
out.mkdir(parents=True,exist_ok=True)
results=[]
for name,command,cwd in checks:
 result=subprocess.run(command,cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace')
 (out/(name+'.log')).write_text(result.stdout+result.stderr,encoding='utf-8')
 results.append({'check':name,'returncode':result.returncode})
 print(f'{name}: {"PASS" if result.returncode==0 else "FAIL"}',flush=True)
(out/'checks.json').write_text(json.dumps({'executed_at':datetime.now(timezone.utc).isoformat(),'results':results},indent=2))
sys.exit(int(any(r['returncode'] for r in results)))
