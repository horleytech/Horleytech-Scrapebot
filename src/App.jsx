import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import TechLogin from './pages/authPages/login';
import Dashboard from './pages/adminDashboard/Dashboard';
import VendorPage from './pages/VendorPage';
import Iphones from './pages/adminDashboardPages/iphones';
import Samsung from './pages/adminDashboardPages/samsung';
import Laptops from './pages/adminDashboardPages/laptops';
import Tablet from './pages/adminDashboardPages/tablet';
import Smartwatch from './pages/adminDashboardPages/smartwatch';
import Sounds from './pages/adminDashboardPages/sounds';
import Ai from './pages/adminDashboardPages/ai';
import UploadData from './pages/adminDashboardPages/UploadData';
import AutoListen from './pages/adminDashboardPages/AutoListen';

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <Routes>
      <Route path="/" element={<TechLogin />} />
      <Route
        path="/vendor/:vendorId"
        element={
          <ProtectedRoute>
            <VendorPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      >
        <Route path="iphones" element={<Iphones />} />
        <Route path="samsung" element={<Samsung />} />
        <Route path="laptops" element={<Laptops />} />
        <Route path="tablet" element={<Tablet />} />
        <Route path="smartwatch" element={<Smartwatch />} />
        <Route path="sounds" element={<Sounds />} />
        <Route path="ai" element={<Ai />} />
        <Route path="upload" element={<UploadData />} />
        <Route path="auto" element={<AutoListen />} />
      </Route>
    </Routes>
  );
}

export default App;
