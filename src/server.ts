import type { ToErroryType } from 'errory'
import { createErroryThings } from 'errory'
import { type Express } from 'express'
import fs from 'fs'
import path from 'path'
import { renderPage } from 'vike/server'
import type { PageContextServer } from 'vike/types'

const findFilePath = ({ cwd, lastPathPart }: { cwd: string; lastPathPart: string }): string | null => {
  const maybeEnvFilePath = path.join(cwd, lastPathPart)
  if (fs.existsSync(maybeEnvFilePath)) {
    return maybeEnvFilePath
  }
  if (cwd === '/') {
    return null
  }
  return findFilePath({ cwd: path.dirname(cwd), lastPathPart })
}

export const createVikeServerThings = <
  TAppContext extends Record<string, any>,
  TExpressRequest extends Express.Request,
  TExtendsOfPageContext extends Record<string, any>,
  TToErroryType extends ToErroryType,
>({
  extendPageContext,
  toErrory,
}: {
  extendPageContext: (appContext: TAppContext, req: TExpressRequest) => Promise<TExtendsOfPageContext>
  toErrory?: TToErroryType
}) => {
  toErrory = toErrory || (createErroryThings().toErrory as TToErroryType)

  const applyVikeAppToExpressApp = async ({
    expressApp,
    appContext,
    mode,
    publicEnv,
    vikeAppPackageJsonPathEnd,
    cwd,
    serverFsAllow,
  }: {
    expressApp: Express
    appContext: TAppContext
    mode: 'production' | 'development'
    publicEnv?: Record<string, string>
    vikeAppPackageJsonPathEnd: string
    cwd: string
    serverFsAllow?: string[]
  }) => {
    const vikeAppPackageJsonPath = findFilePath({ cwd, lastPathPart: vikeAppPackageJsonPathEnd })
    if (!vikeAppPackageJsonPath) {
      throw new Error('webapp package.json not found')
    }
    const root = path.dirname(vikeAppPackageJsonPath)

    // Vite integration
    if (mode === 'production') {
      // In production, we need to serve our static assets ourselves.
      // (In dev, Vite's middleware serves our static assets.)
      const sirv = (await import('sirv')).default
      const distClientPath = path.resolve(root, 'dist/client')
      expressApp.use(sirv(distClientPath))
    } else {
      // We instantiate Vite's development server and integrate its middleware to our server.
      // ⚠️ We instantiate it only in development. (It isn't needed in production and it
      // would unnecessarily bloat our production server.)
      const vite = await import('vite')
      const viteDevMiddleware = (
        await vite.createServer({
          root,
          server: {
            middlewareMode: true,
            fs: {
              allow: serverFsAllow,
            },
          },
        })
      ).middlewares
      expressApp.use(viteDevMiddleware)
    }

    // ...
    // Other middlewares (e.g. some RPC middleware such as Telefunc)
    // ...

    // Vike middleware. It should always be our last middleware (because it's a
    // catch-all middleware superseding any middleware placed after it).
    expressApp.get('*', (req, res, next) => {
      void (async () => {
        try {
          const pageContextInit = {
            urlOriginal: req.originalUrl,
            ...((await extendPageContext?.(appContext as any, req as any)) as {}),
          }
          const pageContext = await renderPage(pageContextInit)
          if (pageContext.errorWhileRendering) {
            // Install error tracking here, see https://vike.dev/errors
          }
          const { httpResponse } = pageContext
          if (!httpResponse) {
            next()
          } else {
            const { body, statusCode, headers, earlyHints } = httpResponse
            if (res.writeEarlyHints) res.writeEarlyHints({ link: earlyHints.map((e) => e.earlyHintLink) })
            for (const [name, value] of headers) res.setHeader(name, value)
            res.status(statusCode)
            // For HTTP streams use httpResponse.pipe() instead, see https://vike.dev/streaming
            const bodyWithEnv = body.replace(
              '{ replaceMeWithPublicEnvFromBackend: true }',
              JSON.stringify(publicEnv, null, 2)
            )
            res.send(bodyWithEnv)
          }
        } catch (error) {
          next(error)
        }
      })()
    })
  }

  const createDataGetter = <TData>(
    dataGetter: (pageContext: PageContextServer) => Promise<TData>
  ): ((pageContext: PageContextServer) => Promise<
    | TData
    | {
        dataGetterError: ReturnType<TToErroryType>
      }
  >) => {
    return (async (pageContext: PageContextServer) => {
      try {
        return await dataGetter(pageContext)
      } catch (error) {
        return {
          dataGetterError: toErrory(error),
        }
      }
    }) as any
  }

  return {
    applyVikeAppToExpressApp,
    extendPageContext,
    createDataGetter,
  }
}
