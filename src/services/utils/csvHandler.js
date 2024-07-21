export const convertToCSV = (data, exportType) => {
  console.log({ rawDataBeforeCSV: data });
  const headers = Object.keys(data[0]).join(',');
  console.log({ headers });
  let headersArray = headers.split(',');

  const rows = data
    .map((row) => {
      const values = Object.values(row);
      console.log({ headersArray });
      const rowResult = headersArray.map((header) => {
        const singleDatum = row[header];
        if (typeof singleDatum === 'string') {
          return singleDatum.replace(/,/g, '');
        }
        return singleDatum;
      });
      return rowResult;
      // const formattedValues = values.map((item) => {
      //   if (typeof item === 'string') {
      //     return item.replace(/,/g, '');
      //   }
      //   return item;
      // });
      // return formattedValues.join(',');
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
