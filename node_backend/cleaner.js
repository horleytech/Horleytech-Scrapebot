export function convertString(stringResponse) {
  if (stringResponse.slice(-1) !== ']') {
    var lastBraceIndex = stringResponse.lastIndexOf('}');
    var convertedString = stringResponse.slice(0, lastBraceIndex + 1) + ']';
  } else {
    var convertedString = stringResponse;
  }
  return convertedString;
}

// Example usage
// var inc = `[
//   {
//     "model": "Samsung NOTE10",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 300000
//   },
//   {
//     "model": "Samsung NOTE10",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "dual",
//     "device_type": "samsung",
//     "price": 320000
//   },
//   {
//     "model": "Samsung NOTE10+",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 340000
//   },
//   {
//     "model": "Samsung NOTE10+",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "dual",
//     "device_type": "samsung",
//     "price": 360000
//   },
//   {
//     "model": "Samsung NOTE20",
//     "storage": "128GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 300000
//   },
//   {
//     "model": "Samsung NOTE20ULTRA",
//     "storage": "128GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 470000
//   },
//   {
//     "model": "Samsung NOTE20ULTRA",
//     "storage": "128GB",
//     "lock_status": "FU",
//     "sim_type": "dual",
//     "device_type": "samsung",
//     "price": 485000
//   },
//   {
//     "model": "Samsung NOTE20ULTRA",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 485000
//   },
//   {
//     "model": "Samsung NOTE20ULTRA",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "dual",
//     "device_type": "samsung",
//     "price": 500000
//   },
//   {
//     "model": "Samsung FLIP3",
//     "storage": "128GB",
//     "lock_status": "FU",
//     "sim_type": null,
//     "device_type": "samsung",
//     "price": 350000
//   },
//   {
//     "model": "Samsung FLIP3",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": null,
//     "device_type": "samsung",
//     "price": 370000
//   },
//   {
//     "model": "Samsung FLIP4",
//     "storage": "128GB",
//     "lock_status": "FU",
//     "sim_type": null,
//     "device_type": "samsung",
//     "price": 430000
//   },
//   {
//     "model": "Samsung FLIP4",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": null,
//     "device_type": "samsung",
//     "price": 450000
//   },
//   {
//     "model": "Samsung FLIP5",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": null,
//     "device_type": "samsung",
//     "price": 700000
//   },
//   {
//     "model": "Samsung FLIP5",
//     "storage": "512GB",
//     "lock_status": "FU",
//     "sim_type": null,
//     "device_type": "samsung",
//     "price": 720000
//   },
//   {
//     "model": "Samsung FOLD2",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": null,
//     "device_type": "samsung",
//     "price": 550000
//   },
//   {
//     "model": "Samsung FOLD2",
//     "storage": "512GB",
//     "lock_status": "FU",
//     "sim_type": null,
//     "device_type": "samsung",
//     "price": 570000
//   },
//   {
//     "model": "Samsung FOLD3",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 650000
//   },
//   {
//     "model": "Samsung FOLD3",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "dual",
//     "device_type": "samsung",
//     "price": 670000
//   },
//   {
//     "model": "Samsung FOLD3",
//     "storage": "512GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 670000
//   },
//   {
//     "model": "Samsung FOLD3",
//     "storage": "512GB",
//     "lock_status": "FU",
//     "sim_type": "dual",
//     "device_type": "samsung",
//     "price": 690000
//   },
//   {
//     "model": "Samsung FOLD4",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 850000
//   },
//   {
//     "model": "Samsung FOLD4",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "dual",
//     "device_type": "samsung",
//     "price": 870000
//   },
//   {
//     "model": "Samsung FOLD4",
//     "storage": "512GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 870000
//   },
//   {
//     "model": "Samsung FOLD4",
//     "storage": "512GB",
//     "lock_status": "FU",
//     "sim_type": "dual",
//     "device_type": "samsung",
//     "price": 890000
//   },
//   {
//     "model": "Samsung FOLD5",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 1100000
//   },
//   {
//     "model": "Samsung FOLD5",
//     "storage": "256GB",
//     "lock_status": "FU",
//     "sim_type": "dual",
//     "device_type": "samsung",
//     "price": 1150000
//   },
//   {
//     "model": "Samsung FOLD5",
//     "storage": "512GB",
//     "lock_status": "FU",
//     "sim_type": "single",
//     "device_type": "samsung",
//     "price": 1150000
//   },
//   {
//     "model": "Samsung FOLD5",
//     "storage": "512GB",
//     "lock_status": "FU",
//     "sim_type": "dual",
//     "device_type": "samsung",
//     "price": 1200000
//   },
//   {
//     "model": "Used Samsung TAB A8",
//     "storage": "32GB",
//     "lock_status": "FU",
//     "sim_type": null,
//     "device_type": "tablet",
//     "price": 200000
//   },
//   {
//     "model": "Used Samsung TAB A8",
//     "storage": "64GB",
//     "lock_status": "FU",
// `;

// const cleanedData = convertString(inc);
// console.log(JSON.parse(cleanedData));
