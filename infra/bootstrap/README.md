# State bucket root

This root manages only `court-context-tfstate-260029269390`. It does not manage Lambdas, schedules, alarms, SNS, or User Notifications.

The bucket already exists. Its bootstrap state is local to this directory and is preserved in a secured backup outside the repository. A fresh checkout does not include that state.

**Do not run `terraform apply` in this directory from an empty state.** An empty state can plan creates for the bucket, versioning, encryption, public-access block, and bucket policy even though those resources already exist. Creating another state bucket, or importing this one into a new state, requires a separate approval. Do not add a remote backend here: this root must not store its state in the bucket it manages.

Production state lives in the production root, `infra/`. That root uses `backend.tf` and the populated key `nba-analytics/infra.tfstate`. Do not point this bootstrap root at that key.

## Accepted production baseline

Copied on 2026-11-09 with Terraform 1.14.6. The local source was lineage `d0fb6df2-0cfa-f38b-1196-11aebecebde6`, serial 403. Saving into the empty S3 backend reset the snapshot metadata. The accepted remote snapshot is lineage `63c7f4c1-2282-61d1-36ec-1126ab6d36ef`, serial 1, S3 version `K5AHpeg1Ieu3I8wNB4UtmfM4MkjEIrdN`. It has 134 resource blocks, 150 instances, and 41 outputs. A full read-only production plan exited 0 with no changes. The serial-403 file remains a historical backup and must never be used as an independent active production state.

## What stays local

This root has no remote backend. `terraform.tfstate` and `terraform.tfstate.backup` are gitignored. They identify the bucket resources and contain no production resource attributes. If a checkout has neither file, stop. Do not init and apply. Recover the secured bootstrap state, or get a separate approval to import the existing bucket.

## Bucket controls

Versioning is enabled. All four Block Public Access settings are true. Object ownership is `BucketOwnerEnforced`. Default encryption is `AES256`, with no KMS key. The bucket policy denies non-TLS requests, principals outside account `260029269390`, and `s3:DeleteBucket`. The current state object is not expired by the lifecycle rule. Noncurrent versions expire only after 90 days and only when more than 30 newer noncurrent versions exist.

## Changes to this root

Use Terraform 1.14.6 and the committed AWS provider lock `5.100.0`. From `infra/bootstrap`, with the existing local state present:

1. `aws sts get-caller-identity` returns account `260029269390`.
2. `terraform validate`.
3. Review `terraform plan`. Do not apply unless that plan was separately approved.
4. Do not run `terraform init -migrate-state`. Do not copy this state into S3.

Destroying the bucket is not an available recovery path while `prevent_destroy` is set and the bucket policy denies `s3:DeleteBucket`. Do not delete `nba-analytics-data-260029269390`.
