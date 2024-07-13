const phones = [
    { "type": "iPhone", "model": "iPhone 13", "storage": "256GB", "price": 1000000, "lock_status": "FU", "sim_type": "ESIM" },
    { "type": "iPhone", "model": "iPhone SE (2022)", "storage": "64GB", "price": 500000, "lock_status": "FU", "sim_type": "Physical Sim" },
    { "type": "iPhone", "model": "iPhone 12", "storage": "128GB", "price": 750000, "lock_status": "FU", "sim_type": "Physical Sim" },
    { "type": "iPhone", "model": "iPhone 14 Pro", "storage": "512GB", "price": 2000000, "lock_status": "FU", "sim_type": "ESIM" },
    { "type": "iPhone", "model": "iPhone 11", "storage": "64GB", "price": 600000, "lock_status": "Carrier Locked", "sim_type": "Physical Sim" },
    { "type": "iPhone", "model": "iPhone XR", "storage": "128GB", "price": 650000, "lock_status": "FU", "sim_type": "Physical Sim" },
    { "type": "iPhone", "model": "iPhone 13 mini", "storage": "256GB", "price": 900000, "lock_status": "FU", "sim_type": "ESIM" },
    { "type": "iPhone", "model": "iPhone 14", "storage": "128GB", "price": 1100000, "lock_status": "FU", "sim_type": "ESIM" },
    { "type": "iPhone", "model": "iPhone 13", "storage": "256GB", "price": 1200000, "lock_status": "FU", "sim_type": "ESIM" },
    { "type": "iPhone", "model": "iPhone 12 Pro Max", "storage": "512GB", "price": 1500000, "lock_status": "Carrier Locked", "sim_type": "Physical Sim" },
    { "type": "iPhone", "model": "iPhone 11 Pro", "storage": "64GB", "price": 800000, "lock_status": "FU", "sim_type": "Physical Sim" },
    { "type": "iPhone", "model": "iPhone SE (2020)", "storage": "128GB", "price": 450000, "lock_status": "FU", "sim_type": "Physical Sim" },
    { "type": "iPhone", "model": "iPhone 13 Pro Max", "storage": "128GB", "price": 980000, "lock_status": "Chip locked", "sim_type": "Physical Sim" },
    { "type": "iPhone", "model": "iPhone 14 Pro Max", "storage": "1TB", "price": 2500000, "lock_status": "FU", "sim_type": "ESIM" },
    { "type": "iPhone", "model": "iPhone 12 mini", "storage": "256GB", "price": 850000, "lock_status": "FU", "sim_type": "ESIM" },
    { "type": "iPhone", "model": "iPhone 11", "storage": "256GB", "price": 700000, "lock_status": "Carrier Locked", "sim_type": "Physical Sim" },
    { "type": "iPhone", "model": "iPhone XR", "storage": "64GB", "price": 550000, "lock_status": "FU", "sim_type": "Physical Sim" },
    { "type": "iPhone", "model": "iPhone 13 Pro", "storage": "256GB", "price": 1400000, "lock_status": "FU", "sim_type": "ESIM" },
    { "type": "iPhone", "model": "iPhone 14", "storage": "256GB", "price": 1300000, "lock_status": "FU", "sim_type": "ESIM" },
    { "type": "iPhone", "model": "iPhone 13", "storage": "256GB", "price": 1500000, "lock_status": "FU", "sim_type": "ESIM" }
  ];
  
  export const groupAndSortPhones = (phones) => {
    console.log('GROUPING DATA IN FUNCTION')
    const grouped = {};
  
    phones.forEach(phone => {
        console.log({phone})
      const key = `${phone.device_type}_${phone.model}_${phone.storage}_${phone.lock_status}_${phone.sim_type}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(phone.price);
    });
  
    const result = [];
  
    Object.keys(grouped).forEach(key => {
      const prices = grouped[key];
      prices.sort((a, b) => b - a);
      
      const [device_type, model, storage, lock_status, sim_type] = key.split('_');
      const H1 = prices[0] || null;
      const H2 = prices[1] || null;
      const H3 = prices[2] || null;
      
      prices.sort((a, b) => a - b);
      const L1 = prices[0] || null;
      const L2 = prices[1] || null;
      const L3 = prices[2] || null;
  
      result.push({
        device_type,
        model,
        storage,
        lock_status,
        sim_type,
        H1,
        H2,
        H3,
        L1,
        L2,
        L3
      });
    });
    
    console.log('DONE GROUPING DATA')
    return result;
  };
  
//   console.log(groupAndSortPhones(phones));