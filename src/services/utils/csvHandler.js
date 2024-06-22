export const convertToCSV = (data) => {
  const headers = Object.keys(data[0]).join(',');
  console.log({ headers });
  const rows = data
    .map((row) => {
      const values = Object.values(row);
      const formattedValues = values.map((item) => {
        if (typeof item === 'string') {
          return item.replace(/,/g, '');
        }
        return item;
      });
      return formattedValues.join(',');
    })
    .join('\n');
  console.log({ rows });
  return `${headers}\n${rows}`;
};

export const downloadCSV = (csv, filename) => {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
