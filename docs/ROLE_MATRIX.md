# Permission matrix

| Capability | Admin | Manager | Auditor | User |
|---|---|---|---|---|
| Enrolled identity create / ordinary suspend / terminal revoke | Own org | No | No | No |
| Signed credential issue/revoke and asset mint/allocate/archive | Own org | Own org | No | No |
| Request/cancel transfer | Current owner | Current owner | No | Current owner |
| Independently approve transfer | Source org; neither owner nor recipient | Same | No | No |
| Accept transfer | Named recipient | Named recipient | No | Named recipient |
| Propose own role/key | Yes | Yes | No | Yes |
| Propose another identity recovery/key | Own org | No | No | No |
| Approve governance proposal | Own org; distinct from requester and target | No | No | No |
| Read audit/metrics | Own org | No | Own org | No |
| Read evidence | Authorized parent + own org | Same | Same | Current owner only |
| Profile | Own private profile | Own | Own | Own |
| Demo reset | Demo only | No | No | No |

Current active certificate binding and organization are enforced independently by API and chaincode. Transfer recipient acceptance and approved key activation have explicit cross-boundary rules; no generic superuser bypass exists. Fixed role permissions are code-reviewed policy. Revoked identities cannot recover. See API_REFERENCE.md for exact action names.
