import { iphoneTable as iphoneJUMIA } from '../../constants/sites/jumia/iphoneJUMIA';
import { laptopTable as laptopJUMIA } from '../../constants/sites/jumia/laptopJUMIA';
import { samsungTable as samsungJUMIA } from '../../constants/sites/jumia/samsungJUMIA';
import { smartwatchTable as smartwatchJUMIA } from '../../constants/sites/jumia/smartwatchJUMIA';
import { soundTable as soundJUMIA } from '../../constants/sites/jumia/soundJUMIA';
import { tabletTable as tabletJUMIA } from '../../constants/sites/jumia/tabletJUMIA';

// obiwezy
import { iphoneTable as iphoneOBIWEZY } from '../../constants/sites/obiwezy/iphoneOBIWEZY';
import { samsungTable as samsungOBIWEZY } from '../../constants/sites/obiwezy/samsungOBIWEZY';

// slot
import { iphoneTable as iphoneSLOT } from '../../constants/sites/slot/iphoneSLOT';
import { laptopTable as laptopSLOT } from '../../constants/sites/slot/laptopSLOT';
import { samsungTable as samsungSLOT } from '../../constants/sites/slot/samsungSLOT';
import { smartwatchTable as smartwatchSLOT } from '../../constants/sites/slot/smartwatchSLOT';
import { soundTable as soundSLOT } from '../../constants/sites/slot/soundSLOT';
import { tabletTable as tabletSLOT } from '../../constants/sites/slot/tabletSLOT';

// jiji
import { iphoneTable as iphoneJIJI } from '../../constants/sites/jiji/iphoneJIJI';
import { laptopTable as laptopJIJI } from '../../constants/sites/jiji/laptopJIJI';
import { samsungTable as samsungJIJI } from '../../constants/sites/jiji/samsungJIJI';
import { smartwatchTable as smartwatchJIJI } from '../../constants/sites/jiji/smartwatchJIJI';
import { soundTable as soundJIJI } from '../../constants/sites/jiji/soundJIJI';
import { tabletTable as tabletJIJI } from '../../constants/sites/jiji/tabletJIJI';

// Justfone
import { iphoneTable as iphoneJustfone } from '../../constants/sites/justfone/iphoneJUSTPHONE';
import { laptopTable as laptopJustfone } from '../../constants/sites/justfone/laptopJUSTPHONE';
import { samsungTable as samsungJustfone } from '../../constants/sites/justfone/samsungJUSTPHONE';
import { smartwatchTable as smartwatchJustfone } from '../../constants/sites/justfone/smartwatchJUSTPHONE';
import { soundTable as soundJustfone } from '../../constants/sites/justfone/soundJUSTPHONE';
import { tabletTable as tabletJustfone } from '../../constants/sites/justfone/tabletJUSTPHONE';

export default class ComparePricesHandler {
  sites = ['Jumia', 'Obiwezy', 'Slot', 'Jiji', 'Justfone'];
  constructor(selectedDeviceName, selectedSite, deviceType) {
    this.selectedDeviceName = selectedDeviceName;
    this.selectedSite = selectedSite;
    this.deviceType = deviceType;
  }

  getPriceData() {
    const result = [];

    for (let i of this.sites) {
      switch (i) {
        case 'Jumia':
          if (this.deviceType === 'iphone') {
            const filteredData = iphoneJUMIA.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            console.log({ filteredData });
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData?.Pname || '',
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'laptop') {
            const filteredData = laptopJUMIA.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'samsung') {
            const filteredData = samsungJUMIA.find(
              (device) => device.Pname === this.selectedDeviceName
            );

            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'smartwatch') {
            const filteredData = smartwatchJUMIA.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'sound') {
            const filteredData = soundJUMIA.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'tablet') {
            const filteredData = tabletJUMIA.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else {
            return null;
          }
          break;
        case 'Obiwezy':
          if (this.deviceType === 'iphone') {
            const filteredData = iphoneOBIWEZY.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'laptop') {
            const filteredData = laptopJUMIA.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'samsung') {
            const filteredData = samsungOBIWEZY.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'smartwatch') {
            const filteredData = smartwatchJUMIA.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'sound') {
            const filteredData = soundJUMIA.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'tablet') {
            const filteredData = tabletJUMIA.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else {
            return null;
          }
          break;
        case 'Slot':
          if (this.deviceType === 'iphone') {
            const filteredData = iphoneSLOT.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'laptop') {
            const filteredData = laptopSLOT.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'samsung') {
            const filteredData = samsungSLOT.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'smartwatch') {
            const filteredData = smartwatchSLOT.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'sound') {
            const filteredData = soundSLOT.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'tablet') {
            const filteredData = tabletSLOT.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else {
            return null;
          }
          break;
        case 'Jiji':
          if (this.deviceType === 'iphone') {
            const filteredData = iphoneJIJI.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'laptop') {
            const filteredData = laptopJIJI.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'samsung') {
            const filteredData = samsungJIJI.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'smartwatch') {
            const filteredData = smartwatchJIJI.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'sound') {
            const filteredData = soundJIJI.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'tablet') {
            const filteredData = tabletJIJI.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else {
            return null;
          }
          break;
        case 'Justfone':
          if (this.deviceType === 'iphone') {
            const filteredData = iphoneJustfone.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'laptop') {
            const filteredData = laptopJustfone.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'samsung') {
            const filteredData = samsungJustfone.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'smartwatch') {
            const filteredData = smartwatchJustfone.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'sound') {
            const filteredData = soundJustfone.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else if (this.deviceType === 'tablet') {
            const filteredData = tabletJustfone.find(
              (device) => device.Pname === this.selectedDeviceName
            );
            if (filteredData) {
              result.push({
                type: i,
                productName: filteredData.Pname,
                link: filteredData.Link,
                H1: filteredData.H1,
                H2: filteredData.H2,
                H3: filteredData.H3,
                L1: filteredData.L1,
                L2: filteredData.L2,
                L3: filteredData.L3,
              });
            }
          } else {
            return null;
          }
          break;

        default:
          break;
      }
    }
    return result;
  }
}
// let x = [
//   {
//     type: 'Jumia',
//     productName: 'apple iphone 15pro max',
//     link: 'www.x.com',
//     price: '1,999,999',
//   },
//   {
//     type: 'Obiwezy',
//     productName: 'apple iphone 15pro max',
//     link: 'www.x.com',
//     price: '1,999,999',
//   },
//   {
//     type: 'Slot',
//     productName: 'apple iphone 15pro max',
//     link: 'www.x.com',
//     price: '1,999,999',
//   },
// ];
