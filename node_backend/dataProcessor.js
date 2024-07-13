export const groupAndSortPhones = (phones) => {
  const grouped = {};

  phones.forEach((phone) => {
    const key = `${phone.device_type}_${phone.model}_${phone.storage || null}_${
      phone.lock_status || null
    }_${phone.sim_type || null}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(phone.price);
  });

  const result = [];

  Object.keys(grouped).forEach((key) => {
    const prices = grouped[key];
    prices.sort((a, b) => b - a);

    const [device_type, model, storage, lock_status, sim_type] = key.split('_');
    const H1 = prices[0] || '0';
    const H2 = prices[1] || '0';
    const H3 = prices[2] || '0';

    prices.sort((a, b) => a - b);
    const L1 = prices[0] || '0';
    const L2 = prices[1] || '0';
    const L3 = prices[2] || '0';

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
      L3,
    });
  });

  return result;
};

//   console.log(groupAndSortPhones(phones));
