import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { iphoneTable as iphoneJUMIA } from '../../constants/sites/jumia/iphoneJUMIA';
import { iphoneTable as iphoneOBIWEZY } from '../../constants/sites/obiwezy/iphoneOBIWEZY';
import { iphoneTable as iphoneSLOT } from '../../constants/sites/slot/iphoneSLOT';
import { iphoneTable as iphoneJIJI } from '../../constants/sites/jiji/iphoneJIJI';
import { iphoneTable as iphoneJustfone } from '../../constants/sites/justfone/iphoneJUSTPHONE';

import { DiApple } from 'react-icons/di';

import Table from '../../components/Table';
import { useSelector } from 'react-redux';
import { db } from '../../services/firebase';

const CATEGORY = 'iphone';

const Iphones = () => {
  const [selectedSite, setSelectedSite] = useState('Jumia'); // Default selected site
  const isOnline = useSelector((state) => state.mode.isOnline);
  const [data, setData] = useState(iphoneJUMIA);
  const [groupNames, setGroupNames] = useState([]);

  const getGroups = async () => {
    const q = query(collection(db, 'groups'));
    const groups = [];
    const querySnapshot = await getDocs(q);
    console.log({ querySnapshot });
    querySnapshot.forEach((doc) => {
      console.log(doc.id, ' => ', doc.data());
      if (doc.data()) groups.push(doc.data().name);
    });
    setGroupNames(groups);
    setSelectedSite(groups[0]);
  };

  const getPrices = async (groupName, deviceCategory) => {
    const q = query(
      collection(db, 'prices'),
      where('group', '==', groupName),
      where('device_type', '==', deviceCategory)
    );
    const prices = [];
    const querySnapshot = await getDocs(q);
    querySnapshot.forEach((doc) => {
      // doc.data() is never undefined for query doc snapshots
      console.log(doc.id, ' => ', doc.data());
      if (doc.data()) prices.push(doc.data());
    });
    console.log({ prices });
    setData(prices);
  };

  useEffect(() => {
    if (!isOnline) {
      setSelectedSite('Offline');
      // setSelectedOfflineSite();
      getGroups();
    } else {
      setSelectedSite('Jumia');
    }
  }, [isOnline]);

  useEffect(() => {
    console.log({ selectedSite });
    switch (selectedSite) {
      case 'Jumia':
        setData(iphoneJUMIA);
        return;
      case 'Obiwezy':
        setData(iphoneOBIWEZY);
        return;
      case 'Slot':
        setData(iphoneSLOT);
        return;
      case 'Jiji':
        setData(iphoneJIJI);
        return;
      case 'JustFone':
        setData(iphoneJustfone);
        return;
      case 'Offline':
        return;
      default:
      // setData(iphoneJUMIA); // Default to Jumia if no match
    }

    console.log('BEFORE IF CHECK');
    if (selectedSite && isOnline === false) {
      console.log('SELECTED OFFLINE SITE AND OFFLINE');
      // fetch the prices here with the corresponding group
      (async function () {
        getPrices(selectedSite, CATEGORY);
      })();
    }
  }, [selectedSite, isOnline]);

  const iconStyle = {
    width: '28px',
    height: '28px',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <DiApple style={iconStyle} />
          <p className="font-bold text-[24px] text-[#1A1C23]">Apple</p>
        </div>

        {isOnline ? (
          <div className="flex items-center">
            <p className="text-[15px] font-semibold text-[#333333] mr-4">
              Sites
            </p>
            <select
              name="sites"
              id=""
              className="h-[35px] rounded-[5px] border-2 border-[#FBFBFB] px-3 text-[15px] outline-none text-[#18191B] mr-4"
              value={selectedSite}
              onChange={(e) => setSelectedSite(e.target.value)}
            >
              <option value="Jumia">Jumia</option>
              {/* <option value="Jiji">Jiji</option> */}
              <option value="Obiwezy">Obiwezy</option>
              <option value="Slot">Slot</option>
              <option value="Jiji">Jiji</option>
              <option value="JustFone">JustFone</option>
            </select>
          </div>
        ) : (
          <div className="flex items-center">
            <p className="text-[15px] font-semibold text-[#333333] mr-4">
              Sites
            </p>
            <select
              name="sites"
              id=""
              className="h-[35px] rounded-[5px] border-2 border-[#FBFBFB] px-3 text-[15px] outline-none text-[#18191B] mr-4"
              value={selectedSite}
              onChange={(e) => setSelectedSite(e.target.value)}
            >
              {groupNames.map((group, index) => (
                <option key={index} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="Apple">
        <Table data={data} site={selectedSite} deviceType={'iphone'} />
      </div>
    </div>
  );
};

export default Iphones;
