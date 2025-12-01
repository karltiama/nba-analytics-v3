# Lambda Files Explanation

## ✅ This is CORRECT - You Didn't Install Anything Wrong!

The `lambda/boxscore-scraper/` directory is **supposed to be in your repo**. Here's what's happening:

## What Should Be in the Repo (Lambda Code)

These files are **source code** and should be committed:
- ✅ `index.ts` - The Lambda function code
- ✅ `package.json` - Dependency definitions
- ✅ `package-lock.json` - Lock file for reproducible builds
- ✅ `tsconfig.json` - TypeScript configuration
- ✅ `README.md` - Documentation
- ✅ `.gitignore` - Now added to ignore build artifacts

## What Should NOT Be in the Repo (Generated Files)

These are **generated/installed** and are now ignored:
- ❌ `node_modules/` - Installed dependencies (ignored by `.gitignore`)
- ❌ `dist/` - Build output (ignored)
- ❌ `*.zip` - Deployment packages (ignored)

## Why This Structure?

This is the **standard Lambda function structure**:
1. **Code files** → In repo (so you can version control them)
2. **Dependencies** → Not in repo (installed via `npm install` when deploying)

## Same Pattern as Your Other Lambda

Your `lambda/odds-pre-game-snapshot/` has the same structure:
- Code files in repo ✅
- `node_modules/` ignored ✅
- Has its own `.gitignore` ✅

## What to Do

1. ✅ **Keep the Lambda code files** - They should be committed
2. ✅ **node_modules is now ignored** - Won't be committed
3. ✅ **When deploying** - Run `npm install` in the Lambda directory to install dependencies

## Summary

**You didn't accidentally install anything!** The Lambda function code belongs in your repo. The `node_modules/` directory is correctly ignored now.

