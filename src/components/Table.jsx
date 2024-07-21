import { useState } from 'react';
import ReactPaginate from 'react-paginate';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';
import folderIcon from '../assets/folderIcon.svg';
import { Button, Dropdown, DropdownItem, Modal } from 'flowbite-react';
import searchIcon from '../assets/search-normal.png';
import { convertToCSV, downloadCSV } from '../services/utils/csvHandler';
import ComparePricesHandler from '../services/utils/comparePrices';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

const Table = ({ data, site, deviceType }) => {
  const isOnline = useSelector((state) => state.mode.isOnline);
  const [usersPerPage, setUsersPerPage] = useState(10);
  const [openModal, setOpenModal] = useState(false);
  const [openCompareModal, setOpenCompareModal] = useState(false);
  //   const [selectedIphone, setSelectedIphone] = useState(null);
  const [pageNumber, setPageNumber] = useState(0);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [priceData, setPriceData] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredData, setFilteredData] = useState(data);

  Table.propTypes = {
    data: PropTypes.array.isRequired,
    site: PropTypes.string,
    deviceType: PropTypes.string.isRequired,
  };

  const pagesVisited = pageNumber * usersPerPage;
  const pageCount = Math.ceil(data.length / usersPerPage);

  // functions
  const handleExport = (type) => {
    const csv = convertToCSV(data, type);
    downloadCSV(csv, 'data.csv');
  };

  const handleSearchOnline = (event) => {
    console.log({ data });
    const value = event.target.value.toLowerCase();
    console.log({ value });
    setSearchTerm(value);
    const filtered = data.filter((item) =>
      item.Pname.toLowerCase().includes(value)
    );
    setFilteredData(filtered);
  };

  const handleSearchOffline = (event) => {
    console.log({ data });
    const value = event.target.value.toLowerCase();
    console.log({ value });
    setSearchTerm(value);
    const filtered = data.filter((item) =>
      item.model.toLowerCase().includes(value)
    );
    setFilteredData(filtered);
  };

  const handleMoreButtonClick = (device) => {
    setSelectedDevice(device);
    setOpenModal(true);
  };

  useEffect(() => {
    setFilteredData(data);
  }, [data]);

  useEffect(() => {
    if (selectedDevice) {
      const priceHandler = new ComparePricesHandler(
        selectedDevice.Pname,
        site,
        deviceType
      );
      setPriceData(priceHandler.getPriceData());
    }
  }, [selectedDevice, deviceType, site]);

  const handleCompareButtonClick = (device) => {
    console.log({ device });
    setSelectedDevice(device);

    setOpenCompareModal(true);
  };

  const changePage = ({ selected }) => {
    setPageNumber(selected);
  };

  // styles
  const drop = {
    '--tw-ring-color': '#1A1C23',
    color: '#1A1C23',
    background: 'white',
    border: '1px solid #CCC',
    // Add other styles if needed
  };

  //   const iconStyle = {
  //     width: '28px',
  //     height: '28px',
  //     // Add any other styles as needed
  //   };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            <p className="text-[15px] text-[#333333] mr-4">Show</p>
            <select
              name="entry"
              id=""
              className="
                            h-[35px] rounded-[5px] border-2 border-[#FBFBFB] px-3 text-[15px] 
                            outline-none text-[#18191B] mr-4"
              value={usersPerPage} // Use the state value here
              onChange={(e) => setUsersPerPage(parseInt(e.target.value))}
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
            </select>
            <p className="text-[15px] text-[#333333] mr-4">entries</p>
          </div>
        </div>

        {/* <div className="flex items-center bg-red-600">
          <div className="flex items-center w-[313px] h-[40px] bg-[#FBFBFB] rounded-lg">
            <input
              type="text"
              name=""
              id=""
              placeholder="Search"
              className="w-[90%] border-none outline-none bg-transparent px-4 text-[13px] placeholder:text-[#0000008C]"
            />
            <img
              className="cursor-pointer"
              src={searchIcon}
              alt="Search icon"
            />
          </div>
        </div> */}
      </div>

      {/* TABLE */}
      {isOnline ? (
        <>
          <div className="flex items-center justify-end m-1">
            <form>
              <div className="flex items-center w-[313px] h-[40px] bg-[#FBFBFB] rounded-lg">
                <input
                  type="text"
                  name=""
                  id=""
                  placeholder="Search"
                  className="w-[90%] border-none outline-none bg-transparent px-4 text-[13px] placeholder:text-[#0000008C]"
                  onChange={handleSearchOnline}
                  value={searchTerm}
                />
                <button type="submit">
                  <img
                    className="cursor-pointer"
                    src={searchIcon}
                    alt="Search icon"
                  />
                </button>
              </div>
            </form>
          </div>
          <table className="w-full table rounded-[10px] mb-10">
            <thead className="h-[60px] border-b border-b-[#DDDCF9]">
              <tr className="text-[#1A1C23] font-bold border-b-[#DDDCF9]">
                <td className="pl-6">Brand</td>
                <td className="px-3">Product Name</td>
                <td className="px-5">Prices</td>
                <td className="px-3">Details</td>
                <td className="px-3">
                  <img
                    src={folderIcon}
                    className="cursor-pointer"
                    onClick={() => handleExport('online')}
                  />
                </td>
              </tr>
            </thead>
            <tbody>
              {filteredData
                .slice(pagesVisited, pagesVisited + usersPerPage)
                .map((device, index) => (
                  <tr
                    className="h-auto"
                    key={device.id}
                    style={{
                      position: 'relative',
                      zIndex: usersPerPage - index,
                    }}
                  >
                    <td className="pl-6 py-3 font-medium text-[15px] text-[#1A1C23]">
                      Apple
                    </td>
                    <td className="py-3 px-3 font-medium text-[15px] capitalize text-[#1A1C23]">
                      {device.Pname}
                    </td>
                    <td className="flex gap-8 py-3 px-5 font-medium text-[15px] text-[#1A1C23]">
                      <Dropdown
                        label="Highest"
                        style={drop}
                        dismissOnClick={false}
                      >
                        <DropdownItem>
                          ₦{device.H1 !== '0' ? device.H1 : '---'}
                        </DropdownItem>
                        <DropdownItem>
                          ₦{device.H2 !== '0' ? device.H2 : '---'}
                        </DropdownItem>
                        <DropdownItem>
                          ₦{device.H3 !== '0' ? device.H3 : '---'}
                        </DropdownItem>
                      </Dropdown>

                      <Dropdown
                        label="Lowest"
                        style={drop}
                        dismissOnClick={false}
                      >
                        <DropdownItem>
                          ₦{device.L1 !== '0' ? device.L1 : '---'}
                        </DropdownItem>
                        <DropdownItem>
                          ₦{device.L2 !== '0' ? device.L2 : '---'}
                        </DropdownItem>
                        <DropdownItem>
                          ₦{device.L3 !== '0' ? device.L3 : '---'}
                        </DropdownItem>
                      </Dropdown>
                    </td>
                    <td className="py-3 font-medium text-[15px] text-[#1A1C23]">
                      <Button
                        style={drop}
                        onClick={() => handleMoreButtonClick(device)}
                      >
                        More...
                      </Button>
                      <Modal
                        show={openModal && selectedDevice === device}
                        className="fixed inset-0 z-50 flex w-screen h-full items-center justify-center backdrop-filter backdrop-blur-sm"
                        onClose={() => setOpenModal(false)}
                      >
                        <div className="fixed w-[97.5%] h-[96.5%] flex justify-center items-center">
                          <div className="w-[400px] bg-white px-8 pt-5 pb-10 rounded-2xl shadow-lg">
                            <Modal.Header className="px-2 py-4">
                              More Information
                            </Modal.Header>
                            <Modal.Body className="py-4">
                              <div className="space-y-6">
                                <p className="text-base font-semibold leading-relaxed text-gray-500 dark:text-gray-400">
                                  Product Name
                                </p>
                                <p className="text-base leading-relaxed capitalize text-gray-500 dark:text-gray-400">
                                  {selectedDevice && selectedDevice.Pname}
                                </p>
                                <p className="text-base font-semibold leading-relaxed text-gray-500 dark:text-gray-400">
                                  Links
                                </p>
                                <p className="text-base leading-relaxed text-[#ffa500]">
                                  <a
                                    href={selectedDevice && selectedDevice.Link}
                                  >
                                    {selectedDevice && selectedDevice.Link}
                                  </a>
                                </p>
                              </div>
                            </Modal.Body>
                          </div>
                        </div>
                      </Modal>
                    </td>
                    <td>
                      <button
                        className="bg-black text-white text-sm p-2 rounded-md font-bold hover:bg-gray-700 hover:opacity-75"
                        onClick={() => handleCompareButtonClick(device)}
                      >
                        Compare Prices
                      </button>
                      {/* Compare Prices Modal */}
                      <Modal
                        show={openCompareModal}
                        className="fixed inset-0 z-50 flex w-screen h-full items-center justify-center backdrop-filter backdrop-blur-sm"
                        onClose={() => setOpenCompareModal(false)}
                      >
                        <div className="fixed w-[97.5%] h-[96.5%] flex justify-center items-center">
                          <div className="w-[90%] bg-white px-8 pt-5 pb-10 rounded-2xl shadow-lg">
                            <Modal.Header className="px-2 py-4">
                              Compare Prices
                            </Modal.Header>
                            <Modal.Body className="py-4">
                              <div className="space-y-6">
                                <table className="w-full table rounded-[10px] mb-10">
                                  <thead className="h-[30px] border-b border-b-[#DDDCF9]">
                                    <tr className="text-[#1A1C23] font-bold border-b-[#DDDCF9] text-left">
                                      <th className="pl-2">Site</th>
                                      <th>Product Name</th>
                                      <th>Link</th>
                                      <th>H1</th>
                                      <th>H2</th>
                                      <th>H3</th>
                                      <th>L1</th>
                                      <th>L2</th>
                                      <th>L3</th>
                                    </tr>
                                  </thead>

                                  <tbody>
                                    {priceData &&
                                      priceData.length > 0 &&
                                      priceData.map((priceDatum, index) => (
                                        <tr
                                          key={index}
                                          className="font-medium text-[15px] text-[#1A1C23]"
                                        >
                                          <td className="py-2 pl-2">
                                            {priceDatum.type}
                                          </td>
                                          <td className="py-2">
                                            {priceDatum.productName}
                                          </td>
                                          <td className="py-2">
                                            <Link
                                              to={priceDatum.link}
                                              className="underline text-blue-600"
                                              target="_blank"
                                            >
                                              Visit Site
                                            </Link>
                                          </td>
                                          <td className="py-2">
                                            {priceDatum.H1
                                              ? priceDatum.H1
                                              : 'nil'}
                                          </td>
                                          <td className="py-2">
                                            {priceDatum.H2
                                              ? priceDatum.H2
                                              : 'nil'}
                                          </td>
                                          <td className="py-2">
                                            {priceDatum.H3
                                              ? priceDatum.H3
                                              : 'nil'}
                                          </td>
                                          <td className="py-2">
                                            {priceDatum.L1
                                              ? priceDatum.L1
                                              : 'nil'}
                                          </td>
                                          <td className="py-2">
                                            {priceDatum.L2
                                              ? priceDatum.L2
                                              : 'nil'}
                                          </td>
                                          <td className="py-2">
                                            {priceDatum.L3
                                              ? priceDatum.L3
                                              : 'nil'}
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            </Modal.Body>
                          </div>
                        </div>
                      </Modal>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      ) : (
        <>
          <div className="flex items-center justify-end m-1">
            <form>
              <div className="flex items-center w-[313px] h-[40px] bg-[#FBFBFB] rounded-lg">
                <input
                  type="text"
                  name=""
                  id=""
                  placeholder="Search"
                  className="w-[90%] border-none outline-none bg-transparent px-4 text-[13px] placeholder:text-[#0000008C]"
                  onChange={handleSearchOffline}
                  value={searchTerm}
                />
                <button type="submit">
                  <img
                    className="cursor-pointer"
                    src={searchIcon}
                    alt="Search icon"
                  />
                </button>
              </div>
            </form>
          </div>
          <table className="w-full table rounded-[10px] mb-10">
            <thead className="h-[60px] border-b border-b-[#DDDCF9]">
              <tr className="text-[#1A1C23] font-bold border-b-[#DDDCF9]">
                <td className="pl-6">Model</td>
                <td className="px-3">Storage</td>
                <td className="px-5">Prices</td>
                <td className="px-3">Lock Status</td>
                <td className="px-3">Sim Type</td>
                <td className="px-3">
                  <img
                    src={folderIcon}
                    className="cursor-pointer"
                    onClick={() => handleExport('offline')}
                  />
                </td>
              </tr>
            </thead>
            {data.length > 0 ? (
              <tbody>
                {filteredData
                  .slice(pagesVisited, pagesVisited + usersPerPage)
                  .map((device, index) => (
                    <tr
                      className="h-auto"
                      key={device.id}
                      style={{
                        position: 'relative',
                        zIndex: usersPerPage - index,
                      }}
                    >
                      <td className="pl-6 py-3 font-medium text-[15px] text-[#1A1C23]">
                        {device.model}
                      </td>
                      <td className="py-3 px-3 font-medium text-[15px] capitalize text-[#1A1C23]">
                        {device.storage}
                      </td>
                      <td className="flex gap-8 py-3 px-5 font-medium text-[15px] text-[#1A1C23]">
                        <Dropdown
                          label="Highest"
                          style={drop}
                          dismissOnClick={false}
                        >
                          <DropdownItem>
                            ₦{device.H1 !== '0' ? device.H1 : '---'}
                          </DropdownItem>
                          <DropdownItem>
                            ₦{device.H2 !== '0' ? device.H2 : '---'}
                          </DropdownItem>
                          <DropdownItem>
                            ₦{device.H3 !== '0' ? device.H3 : '---'}
                          </DropdownItem>
                        </Dropdown>

                        <Dropdown
                          label="Lowest"
                          style={drop}
                          dismissOnClick={false}
                        >
                          <DropdownItem>
                            ₦{device.L1 !== '0' ? device.L1 : '---'}
                          </DropdownItem>
                          <DropdownItem>
                            ₦{device.L2 !== '0' ? device.L2 : '---'}
                          </DropdownItem>
                          <DropdownItem>
                            ₦{device.L3 !== '0' ? device.L3 : '---'}
                          </DropdownItem>
                        </Dropdown>
                      </td>
                      <td className="py-3 font-medium text-[15px] text-[#1A1C23]">
                        {device.lock_status}
                      </td>
                      <td className="py-3 font-medium text-[15px] text-[#1A1C23]">
                        {device.sim_type}
                      </td>
                    </tr>
                  ))}
              </tbody>
            ) : (
              <tbody>
                <p>No Offline Data Yet</p>
              </tbody>
            )}
          </table>
        </>
      )}

      {/* pagination */}
      <div className="flex items-center justify-between pb-10">
        <p className="font-medium text-[15px] text-[#1A1C23]">
          Showing 1 to {usersPerPage} of {pageCount} entries
        </p>

        <div className="flex items-center gap-4">
          <ReactPaginate
            previousLabel={'Previous'}
            nextLabel={'Next'}
            pageCount={pageCount}
            onPageChange={changePage}
            containerClassName={'paginationBttns'}
            previousLinkClassName={'previousBttn'}
            nextLinkClassName={'nextBttn'}
            disabledClassName={'paginationDisabled'}
            activeClassName={'paginationActive'}
            pageLinkClassName={'paginationNum'}
          />
        </div>
      </div>
    </div>
  );
};

export default Table;
