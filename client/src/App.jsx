import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import ProtectedRoute from './components/auth/ProtectedRoute.jsx'
import PublicOnlyRoute from './components/auth/PublicOnlyRoute.jsx'
import Layout from './components/layout/Layout.jsx'
import PublicLayout from './components/layout/PublicLayout.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import Appointments from './pages/Appointments.jsx'
import ChatUI from './pages/ChatUI.jsx'
import Home from './pages/Home.jsx'
import Hospitals from './pages/Hospitals.jsx'
import Login from './pages/Login.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
import Medicines from './pages/Medicines.jsx'
import Prescriptions from './pages/Prescriptions.jsx'
import Profile from './pages/Profile.jsx'
import Register from './pages/Register.jsx'

function publicAuthPage(element) {
  return <PublicOnlyRoute>{element}</PublicOnlyRoute>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Home />} />
            <Route path="login" element={publicAuthPage(<Login />)} />
            <Route path="register" element={publicAuthPage(<Register />)} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="reset-password" element={<ResetPassword />} />
          </Route>

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="profile" element={<Profile />} />
            <Route path="dashboard" element={<Navigate to="/appointments" replace />} />
            <Route path="medicines" element={<Medicines />} />
            <Route path="prescriptions" element={<Prescriptions />} />
            <Route path="hospitals" element={<Hospitals />} />
            <Route path="appointments" element={<Appointments />} />
            <Route path="chat" element={<ChatUI />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
