import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
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

function App() {
  return (
    <Routes>
      <Route path="/" element={<TechLogin />} />
      <Route path="/login" element={<TechLogin />} />

      {/* 🔴 PUBLIC ROUTE: Anyone with the admin/vendor inventory link can view full inventory */}
      <Route path="/vendor/:vendorId" element={<VendorPage />} />

      {/* 🟢 PUBLIC STOREFRONT: Customer-facing page with visible products only */}
      <Route path="/store/:vendorId" element={<StoreFront />} />

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
      </Route>

      <Route
        path="/admin/dashboard"
        element={
          <AdminRoute>
            <Navigate to="/dashboard" replace />
          </AdminRoute>
        }
      />

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
