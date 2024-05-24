import { createErroryThings, type ErroryType } from 'errory'
import type { PageContextServer } from 'vike/types'

export const createVikeClientThings = <TErroryType extends ErroryType>({ Errory }: { Errory?: TErroryType } = {}) => {
  Errory = Errory || (createErroryThings().Errory as TErroryType)

  const createDataGetter = <TData,>(
    dataGetter: (pageContext: PageContextServer) => Promise<TData>
  ): ((pageContext: PageContextServer) => Promise<
    | TData
    | {
        dataGetterError: ReturnType<TErroryType['toErrory']>
      }
  >) => {
    return (async (pageContext: PageContextServer) => {
      try {
        return await dataGetter(pageContext)
      } catch (error) {
        return {
          dataGetterError: Errory.toErrory(error),
        }
      }
    }) as any
  }

  return {
    createDataGetter,
  }
}
