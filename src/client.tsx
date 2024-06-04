import { createErroryThings, type ErroryType } from 'errory'
import type { PageContextServer } from 'vike/types'

export const createVikeClientThings = <
  TErroryType extends ErroryType,
  TDataGetterResultExtra extends Record<string, any> = {},
>({
  Errory,
  dataGetterResultExtender = () => ({}) as TDataGetterResultExtra,
}: {
  Errory?: TErroryType
  dataGetterResultExtender?: (pageContext: PageContextServer) => TDataGetterResultExtra
}) => {
  Errory = Errory || (createErroryThings().Errory as TErroryType)

  const createDataGetter = <TData,>(
    dataGetter: (pageContext: PageContextServer) => Promise<TData>
  ): ((pageContext: PageContextServer) => Promise<
    | (TData & TDataGetterResultExtra)
    | ({
        dataGetterError: ReturnType<TErroryType['toErrory']>
      } & TDataGetterResultExtra)
  >) => {
    return (async (pageContext: PageContextServer) => {
      const result = await (async () => {
        try {
          return await dataGetter(pageContext)
        } catch (error) {
          return {
            dataGetterError: Errory.toErrory(error),
          }
        }
      })()
      const extra = dataGetterResultExtender(pageContext)
      return {
        ...result,
        ...extra,
      } as any
    }) as any
  }

  return {
    createDataGetter,
  }
}
