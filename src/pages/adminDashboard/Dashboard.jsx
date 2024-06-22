// import React from "react";
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import AdminDashboardLayout from '../../components/layouts/DashboardLayout';

const AdminDashboard = () => {
  const location = useLocation();

  if (location.pathname === '/dashboard') {
    return <Navigate to="iphones" />;
  }

  return (
    <AdminDashboardLayout>
      <Outlet />
    </AdminDashboardLayout>
  );
};

export default AdminDashboard;
