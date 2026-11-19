// Outputs reviewable SQL only. This script never executes a grant or a payment.
// Usage: node scripts/image-credit-grant.mjs USER_ID CREDITS UNIQUE_REFERENCE > grant.sql
const [userId,amount,reference]=process.argv.slice(2);
if(!userId || userId.length>160 || !/^[1-9][0-9]{0,7}$/.test(amount||'') || !/^[A-Za-z0-9_-]{8,100}$/.test(reference||'')) throw Error('Usage: USER_ID POSITIVE_INTEGER_CREDITS UNIQUE_REFERENCE(8-100 safe characters)');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
// Trigger grants the wallet atomically. A duplicate reference cannot grant twice.
process.stdout.write(`INSERT INTO image_credit_ledger (user_id,job_id,event,delta,reference,created_at) VALUES (${quote(userId)},NULL,'grant',${Number(amount)},${quote(reference)},unixepoch()) ON CONFLICT(reference) DO NOTHING;\n`);
