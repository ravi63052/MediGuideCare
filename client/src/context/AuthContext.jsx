import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import {
  getCurrentUser,
  loginUser as apiLogin,
  logoutUser as apiLogout,
  registerUser as apiRegister,
  verifyLoginOtp as apiVerifyLoginOtp,
  deleteProfilePhoto as apiDeleteProfilePhoto,
  uploadProfilePhoto as apiUploadProfilePhoto,
  updateUserProfile,
} from '../api.js'
import {
  clearProfilePhotoCache,
  getProfilePhotoKey,
  primeProfilePhotoCache,
} from '../utils/profilePhotoCache.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profilePhotoVersion, setProfilePhotoVersion] = useState(0)

  const refreshUser = useCallback(async () => {
    try {
      const result = await getCurrentUser()
      setUser(result.user)
      return result.user
    } catch {
      clearProfilePhotoCache()
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  const login = useCallback(async (credentials, options) => {
    return apiLogin(credentials, options)
  }, [])

  const verifyLoginOtp = useCallback(async (email, code) => {
    const result = await apiVerifyLoginOtp(email, code)
    clearProfilePhotoCache()
    setUser(result.user)
    return result.user
  }, [])

  const register = useCallback(async (details, options) => {
    return apiRegister(details, options)
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiLogout()
    } finally {
      clearProfilePhotoCache()
      setUser(null)
    }
  }, [])

  const saveProfile = useCallback(async (details) => {
    const result = await updateUserProfile(details)
    setUser(result.user)
    return result.user
  }, [])

  const saveProfilePhoto = useCallback(async (file) => {
    const result = await apiUploadProfilePhoto(file)
    // The uploaded file is already available locally, so show it immediately
    // instead of downloading the same image again after saving.
    primeProfilePhotoCache(getProfilePhotoKey(result.user), file)
    setUser(result.user)
    setProfilePhotoVersion((version) => version + 1)
    return result.user
  }, [])

  const removeProfilePhoto = useCallback(async () => {
    const result = await apiDeleteProfilePhoto()
    clearProfilePhotoCache()
    setUser(result.user)
    setProfilePhotoVersion((version) => version + 1)
    return result.user
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      verifyLoginOtp,
      register,
      logout,
      refreshUser,
      saveProfile,
      saveProfilePhoto,
      removeProfilePhoto,
      profilePhotoVersion,
    }),
    [user, loading, login, verifyLoginOtp, register, logout, refreshUser, saveProfile, saveProfilePhoto, removeProfilePhoto, profilePhotoVersion],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
