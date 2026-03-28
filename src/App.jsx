import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';
import TechLogin from './pages/authPages/login';
import Dashboard from './pages/adminDashboard/Dashboard';
import VendorPage from './pages/VendorPage';
import UploadData from './pages/adminDashboardPages/UploadData';
import AutoListen from './pages/adminDashboardPages/AutoListen';
import StoreFront from './pages/StoreFront';
import AppHub from './pages/AppHub';
import TeamManagement from './pages/adminDashboardPages/TeamManagement';

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return children;
};

const AdminRoute = ({ children }) => {
  const { isAuthenticated, user } = useSelector((state) => state.auth);
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (user?.role === 'staff') return <Navigate to="/hub" replace />;
  return children;
};

ProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

AdminRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

function App() {
  return (
    <Routes>
      <Route path="/" element={<TechLogin />} />
      <Route path="/login" element={<TechLogin />} />

      {/* 🔴 PUBLIC ROUTE: Anyone with the admin/vendor inventory link can view full inventory */}
      <Route path="/vendor/:vendorId" element={<VendorPage />} />

      {/* 🟢 PUBLIC STOREFRONTS: Independent Store 1 (Classic) and Store 2 (Premium) */}
      <Route path="/store/1/:vendorId" element={<StoreFront storeType="1" />} />
      <Route path="/store/2/:vendorId" element={<StoreFront storeType="2" />} />
      {/* Fallback route goes to Store 1 */}
      <Route path="/store/:vendorId" element={<StoreFront storeType="1" />} />

      <Route
        path="/hub"
        element={
          <ProtectedRoute>
            <AppHub />
          </ProtectedRoute>
        }
      />

      {/* 🟢 PROTECTED ROUTES: Only logged-in admins can access the main dashboard */}
      <Route
        path="/dashboard"
        element={
          <AdminRoute>
            <Dashboard />
          </AdminRoute>
        }
      >
        <Route path="upload" element={<UploadData />} />
        <Route path="autolisten" element={<AutoListen />} />
        <Route path="logic" element={<Navigate to="/dashboard/upload" replace />} />
        <Route path="requestsbot" element={<Navigate to="/dashboard/autolisten" replace />} />
        <Route path="dashboard" element={<Navigate to="/dashboard" replace />} />
      </Route>

      <Route
        path="/admin/dashboard"
        element={
          <AdminRoute>
            <Navigate to="/dashboard" replace />
          </AdminRoute>
        }
      />
      <Route path="/admin/logic" element={<Navigate to="/dashboard/upload" replace />} />
      <Route path="/admin/requestsbot" element={<Navigate to="/dashboard/autolisten" replace />} />

      <Route
        path="/admin/team"
        element={
          <AdminRoute>
            <TeamManagement />
          </AdminRoute>
        }
      />
    </Routes>
  );
}

export default App;
