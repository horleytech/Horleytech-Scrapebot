/* eslint-disable react/prop-types */

import { Fragment, useState } from 'react';
import { Dialog, Menu, Transition } from '@headlessui/react';
import UserProfile from '../../assets/user.svg';
import Logo from '../../assets/logo.png';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { TbLogin2 } from 'react-icons/tb';
import { IoMdNotifications } from 'react-icons/io';
import { Link, useLocation } from 'react-router-dom';
import { DiApple, DiSmashingMagazine } from 'react-icons/di';
import { FaLaptop, FaTabletAlt } from 'react-icons/fa';
import { IoWatch } from 'react-icons/io5';
import { BsEarbuds } from 'react-icons/bs';
import { BsFillCpuFill } from 'react-icons/bs';
import { useDispatch, useSelector } from 'react-redux';
import { toggleMode } from '../../services/reducers/mode/modeReducer';

export const OnlineOfflineSwitch = () => {
  const dispatch = useDispatch();
  const mode = useSelector((state) => state.mode);

  const toggleSwitch = () => {
    dispatch(toggleMode());
  };

  return (
    <div className="flex items-center  w-40">
      <div
        className={`w-full h-8 bg-[#EBEBEB] rounded-full flex items-center cursor-pointer font-bold ${
          !mode.isOnline && 'justify-end'
        }`}
        onClick={toggleSwitch}
      >
        {/* online */}
        <div
          className={`${
            !mode.isOnline
              ? 'mr-3'
              : 'w-1/2 h-full bg-white border border-[#EBEBEB] rounded-full flex items-center justify-center'
          }`}
        >
          Online
        </div>

        {/* Offline */}
        <div
          className={` ${
            mode.isOnline
              ? 'ml-3'
              : 'w-1/2 h-full bg-white border border-[#EBEBEB] rounded-full flex items-center justify-center'
          }`}
        >
          Offline
        </div>
      </div>
    </div>
  );
};

const adminNavigation = [
  { name: 'Iphones', href: 'iphones', icon: DiApple, current: true },
  {
    name: 'Samsung',
    href: 'samsung',
    icon: DiSmashingMagazine,
    current: false,
  },
  { name: 'Laptops', href: 'laptops', icon: FaLaptop, current: false },
  { name: 'Tablet', href: 'tablet', icon: FaTabletAlt, current: false },
  { name: 'Smartwatch', href: 'smartwatch', icon: IoWatch, current: false },
  { name: 'Sounds', href: 'sounds', icon: BsEarbuds, current: false },
  {
    name: 'AI TXT Analyzer',
    href: 'ai',
    icon: BsFillCpuFill,
    current: false,
  },
];

function classNames(...classes) {
  return classes.filter(Boolean).join(' ');
}

export default function MenteeDashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  let role = 'ADMIN';

  const getNavOptions = () => {
    if (role === 'ADMIN') {
      return adminNavigation;
    }
  };

  const location = useLocation();

  return (
    <>
      <div>
        <Transition.Root show={sidebarOpen} as={Fragment}>
          <Dialog
            as="div"
            className="relative z-50 lg:hidden"
            onClose={setSidebarOpen}
          >
            <Transition.Child
              as={Fragment}
              enter="transition-opacity ease-linear duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity ease-linear duration-300"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-gray-900/80" />
            </Transition.Child>

            <div className="fixed inset-0 flex">
              <Transition.Child
                as={Fragment}
                enter="transition ease-in-out duration-300 transform"
                enterFrom="-translate-x-full"
                enterTo="translate-x-0"
                leave="transition ease-in-out duration-300 transform"
                leaveFrom="translate-x-0"
                leaveTo="-translate-x-full"
              >
                <Dialog.Panel className="relative flex flex-1 w-full max-w-xs mr-16">
                  <Transition.Child
                    as={Fragment}
                    enter="ease-in-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in-out duration-300"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                  >
                    <div className="absolute top-0 flex justify-center w-16 pt-5 left-full">
                      <button
                        type="button"
                        className="-m-2.5 p-2.5"
                        onClick={() => setSidebarOpen(false)}
                      >
                        <span className="sr-only">Close sidebar</span>
                        <XMarkIcon
                          className="w-6 h-6 text-white"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </Transition.Child>
                  {/* Sidebar component, Starts Here*/}

                  <div className="flex flex-col px-6 pb-4 overflow-y-auto bg-white grow gap-y-5">
                    <div className="flex items-center justify-center p-10 h-16 shrink-0">
                      <img
                        className="w-auto h-auto mx-20"
                        src={Logo}
                        alt="HorleyTech"
                        width="64"
                        height="64"
                      />
                    </div>
                    <nav className="flex flex-col flex-1">
                      <ul role="list" className="flex flex-col flex-1 gap-y-7">
                        <li>
                          <ul role="list" className="-mx-2 space-y-1">
                            {getNavOptions().map((item, index) => (
                              <li key={index}>
                                <Link
                                  to={item.href}
                                  href={item.route}
                                  className={classNames(
                                    location.pathname.includes(
                                      `/dashboard/${item.href}`
                                    )
                                      ? 'bg-[#1A1C23] text-white font-bold'
                                      : 'text-[#1A1C23] hover:text-white hover:bg-[#1A1C23]',
                                    'group flex gap-x-3 rounded-md p-2 text-sm leading-6 transition-all duration-700'
                                  )}
                                >
                                  <item.icon
                                    className={classNames(
                                      location.pathname.includes(
                                        `/dashboard/${item.href}`
                                      )
                                        ? 'text-white'
                                        : 'text-[#1A1C23] group-hover:text-white',
                                      'h-6 w-6 shrink-0'
                                    )}
                                    aria-hidden="true"
                                  />
                                  {item.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </li>
                        <li className="mt-auto">
                          <Link
                            to="/"
                            className="flex p-2 -mx-2 text-sm leading-6 text-gray-700 rounded-md group gap-x-3 hover:bg-gray-50 hover:text-black"
                          >
                            <TbLogin2
                              className="w-6 h-6 shrink-0 text-lightBlue group-hover:text-black"
                              aria-hidden="true"
                            />
                            Logout
                          </Link>
                        </li>
                      </ul>
                    </nav>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </Dialog>
        </Transition.Root>

        <div className="flex flex-row w-screen h-screen overflow-hidden">
          {/* Static sidebar for desktop */}
          <div className="hidden lg:h-screen lg:inset-y-0 lg:z-50 lg:flex lg:w-[15rem] lg:flex-col">
            {/* Sidebar component, swap this element with another sidebar if you like */}
            <div className="flex flex-col px-6 pb-4 overflow-y-auto bg-white border-r border-gray-200 grow gap-y-5">
              <div className="flex items-center justify-center h-16 mx-auto shrink-0">
                <img
                  className="w-auto h-8"
                  src={Logo}
                  alt="HorleyTech"
                  width="64"
                  height="64"
                />
              </div>
              <nav className="flex flex-col flex-1">
                <ul role="list" className="flex flex-col flex-1 gap-y-7">
                  <li>
                    <ul role="list" className="-mx-2 space-y-3">
                      {getNavOptions().map((item, index) => (
                        <li key={index}>
                          <Link
                            to={item.href}
                            className={classNames(
                              location.pathname.includes(
                                `/dashboard/${item.href}`
                              )
                                ? 'bg-[#1A1C23] text-white font-bold'
                                : 'text-[#1A1C23] hover:text-white hover:bg-[#1A1C23]',
                              'group flex gap-x-3 rounded-md p-2 text-sm leading-6 transition-all duration-700'
                            )}
                          >
                            <item.icon
                              className={classNames(
                                location.pathname.includes(
                                  `/dashboard/${item.href}`
                                )
                                  ? 'text-white'
                                  : 'text-[#1A1C23] group-hover:text-white',
                                'h-6 w-6 shrink-0'
                              )}
                              aria-hidden="true"
                            />
                            {item.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                  <li className="mt-auto">
                    <Link
                      to="/"
                      className="flex p-2 -mx-2 text-sm leading-6 text-gray-700 rounded-md group gap-x-3 hover:bg-gray-50 hover:text-black"
                    >
                      <TbLogin2
                        className="w-6 h-6 shrink-0 text-lightBlue group-hover:text-black"
                        aria-hidden="true"
                      />
                      Logout
                    </Link>
                  </li>
                </ul>
              </nav>
            </div>
          </div>

          <div className="lg:w-[calc(100vw-15rem)] w-full">
            <div className="relative z-40 flex items-center w-full h-16 px-4 bg-white border-b border-gray-200 shadow-sm shrink-0 gap-x-4 sm:gap-x-6 sm:px-6 lg:px-8">
              <button
                type="button"
                className="-m-2.5 p-2.5 text-gray-700 lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <span className="sr-only">Open sidebar</span>
                <Bars3Icon className="w-6 h-6" aria-hidden="true" />
              </button>

              {/* Separator */}
              <div
                className="w-px h-6 bg-gray-200 lg:hidden"
                aria-hidden="true"
              />

              {/* NAV PART */}
              <div className="flex self-stretch justify-end flex-1 gap-x-4 lg:gap-x-6">
                <OnlineOfflineSwitch />
                <div className="flex items-center gap-x-4 lg:gap-x-6">
                  <button
                    type="button"
                    className="-m-2.5 p-2.5 text-gray-400 hover:text-gray-500"
                  >
                    <span className="sr-only">View notifications</span>
                    <IoMdNotifications
                      className="w-6 h-6 text-black"
                      aria-hidden="true"
                    />
                  </button>

                  {/* Separator */}
                  <div
                    className="hidden lg:block lg:h-6 lg:w-px lg:bg-gray-200"
                    aria-hidden="true"
                  />

                  {/* Profile dropdown */}
                  <Menu as="div" className="relative">
                    <Menu.Button className="-m-1.5 flex items-center p-1.5">
                      <img
                        className="w-8 h-8 p-2 rounded-full bg-[#ffa500]"
                        src={UserProfile}
                        alt=""
                        width={100}
                        height={100}
                      />
                    </Menu.Button>
                  </Menu>
                </div>
              </div>
            </div>

            <main className="pt-10 pb-10 lg:pb-24 overflow-scroll h-[100vh] px-4 sm:px-6 lg:px-8 scroll-smooth transition-all">
              <div className="max-w-[1200px] mx-auto">{children}</div>
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
