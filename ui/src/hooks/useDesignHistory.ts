/**
 * useDesignHistory Hook
 *
 * Fetches and subscribes to design history updates from the API.
 * Follows the same pattern as useDiagramHistory.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from '@/hooks/useSession'
import { api } from '@/lib/api'
import type { DesignHistory, UseDesignHistoryReturn } from '@/types/history'

export function useDesignHistory(designId: string | null): UseDesignHistoryReturn {
  const [history, setHistory] = useState<DesignHistory | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { currentSession } = useSession()
  const project = currentSession?.project ?? null
  const session = currentSession?.name ?? null

  // Keep a ref to the current designId to check for staleness
  const designIdRef = useRef(designId)
  designIdRef.current = designId

  const fetchHistory = useCallback(async (signal?: AbortSignal) => {
    if (!designId || !project || !session) {
      setHistory(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const data = await api.getDesignHistory(project, session, designId, signal)

      // Check if designId is still current when response arrives
      if (designIdRef.current !== designId) return

      if (data === null) {
        setHistory(null)
      } else {
        setHistory(data)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (designIdRef.current !== designId) return
      setError('Network error')
    } finally {
      if (designIdRef.current === designId) {
        setIsLoading(false)
      }
    }
  }, [designId, project, session])

  const getVersionAt = useCallback(
    async (timestamp: string): Promise<string | null> => {
      if (!designId || !project || !session) return null

      try {
        const data = await api.getDesignVersion(project, session, designId, timestamp)
        if (data) {
          return data.content
        }
      } catch {
        // Ignore errors, return null
      }
      return null
    },
    [designId, project, session]
  )

  useEffect(() => {
    if (!designId) {
      setHistory(null)
      return
    }
    const controller = new AbortController()
    fetchHistory(controller.signal)
    return () => controller.abort()
  }, [fetchHistory, designId])

  const refetch = useCallback(() => fetchHistory(), [fetchHistory])

  return { history, isLoading, error, refetch, getVersionAt }
}
