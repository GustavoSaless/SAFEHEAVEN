import { createContext, useContext } from 'react'
export const PatientCtx = createContext(null)
export const usePatient = () => useContext(PatientCtx)
