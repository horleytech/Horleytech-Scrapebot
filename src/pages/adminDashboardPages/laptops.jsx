import { useState } from 'react';
import { laptopTable as laptopJUMIA } from '../../constants/sites/jumia/laptopJUMIA';
// import { laptopTable as laptopJIJI } from "../../constants/sites/jiji/laptopJIJI";
// import { laptopTable as laptopOBIWEZY } from "../../constants/sites/obiwezy/laptopOBIWEZY";
import { laptopTable as laptopSLOT } from '../../constants/sites/slot/laptopSLOT';
import { laptopTable as laptopJIJI } from '../../constants/sites/jiji/laptopJIJI';
import { FaLaptop } from 'react-icons/fa';
import { useEffect } from 'react';

import Table from '../../components/Table';
import { useSelector } from 'react-redux';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';

const CATEGORY = 'laptop';

const Laptops = () => {
  const [selectedSite, setSelectedSite] = useState('Jumia'); // Default selected site
  const [data, setData] = useState(laptopJUMIA);
  const isOnline = useSelector((state) => state.mode.isOnline);
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

  const iconStyle = {
    width: '28px',
    height: '28px',
    // Add any other styles as needed
  };

  useEffect(() => {
    if (!isOnline) {
      setSelectedSite('Offline');
      getGroups();
    } else {
      setSelectedSite('Jumia');
    }
  }, [isOnline]);

  useEffect(() => {
    switch (selectedSite) {
      case 'Jumia':
        setData(laptopJUMIA);
        return;
      case 'Obiwezy':
        setData([]);
        return;
      case 'Slot':
        setData(laptopSLOT);
        return;
      case 'Jiji':
        setData(laptopJIJI);
        return;
      case 'Offline':
        // setData(laptopOffline);
        return;
      default:
      // setData(laptopJUMIA); // Default to Jumia if no match
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FaLaptop style={iconStyle} />
          <p className="font-bold text-[24px] text-[#1A1C23]">Laptops</p>
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

      <div className="Laptops">
        <Table data={data} site={selectedSite} deviceType={'laptop'} />
      </div>
    </div>
  );
};

export default Laptops;
