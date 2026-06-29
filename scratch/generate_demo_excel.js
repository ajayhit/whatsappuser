import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const targetPath = path.join(publicDir, 'demo_recipients.xlsx');

console.log('Generating demo Excel sheet with single "phonenumber" column...');

const demoData = [
  {
    "phonenumber": "9876543210"
  },
  {
    "phonenumber": "9876543211"
  },
  {
    "phonenumber": "9876543212"
  }
];

const worksheet = xlsx.utils.json_to_sheet(demoData);
const workbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(workbook, worksheet, 'Recipients');

// Ensure public directory exists
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

xlsx.writeFile(workbook, targetPath);
console.log(`Demo Excel file written to: ${targetPath}`);
