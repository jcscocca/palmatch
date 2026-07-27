import { createContext, useContext } from 'react'
import type { Dataset } from '../engine/types.ts'

/** Set once by `App` after the dataset loads; React 19 renders the context object itself as the provider. */
export const DatasetContext = createContext<Dataset | null>(null)

export function useDataset(): Dataset {
  const ds = useContext(DatasetContext)
  if (ds === null) throw new Error('useDataset: no DatasetContext provider above this component')
  return ds
}
