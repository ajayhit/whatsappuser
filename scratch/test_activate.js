import { getActivePlan, activatePlan, initDb } from '../db.js';
import dotenv from 'dotenv';
dotenv.config();

initDb();

const userId = 3;
console.log('--- BEFORE PLAN ACTIVATION ---');
const activeBefore = getActivePlan(userId);
console.log('Active Plan Before:', activeBefore);
if (activeBefore) {
  console.log('Expiry date parse test:', new Date(activeBefore.expires_at));
  console.log('Current date:', new Date());
  console.log('Is in future?', new Date(activeBefore.expires_at) > new Date());
}

console.log('\n--- RUNNING ACTIVATE PLAN ---');
const newPlan = activatePlan(userId);
console.log('New Plan Created:', newPlan);

console.log('\n--- AFTER PLAN ACTIVATION ---');
const activeAfter = getActivePlan(userId);
console.log('Active Plan After:', activeAfter);
