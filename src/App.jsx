// import React from "react";
// import { SpeedInsights } from "@vercel/speed-insights/next";
import { Routes, Route } from 'react-router-dom';
import TechLogin from './pages/authPages/login';
import Dashboard from './pages/adminDashboard/Dashboard';

// GADGET DASHBOARD IMPORTS
import Iphones from './pages/adminDashboardPages/iphones';
import Samsung from './pages/adminDashboardPages/samsung';
import Laptops from './pages/adminDashboardPages/laptops';
import Tablet from './pages/adminDashboardPages/tablet';
import Smartwatch from './pages/adminDashboardPages/smartwatch';
import Sounds from './pages/adminDashboardPages/sounds';
import Ai from './pages/adminDashboardPages/ai';

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<TechLogin />} />

        <Route path="/dashboard" element={<Dashboard />}>
          <Route index path="iphones" element={<Iphones />} />
          <Route path="samsung" element={<Samsung />} />
          <Route path="laptops" element={<Laptops />} />
          <Route path="tablet" element={<Tablet />} />
          <Route path="smartwatch" element={<Smartwatch />} />
          <Route path="sounds" element={<Sounds />} />
          <Route path="ai" element={<Ai />} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
