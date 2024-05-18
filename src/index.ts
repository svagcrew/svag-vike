import { type Express } from 'express'
import fs from 'fs'
import path from 'path'
import { renderPage } from 'vike/server'

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

export const applyVikeAppToExpressApp = async <
  TAppContext,
  TExtendedPageContext,
  TExpressRerquest extends Express.Request,
>({
  expressApp,
  appContext,
  mode,
  publicEnv,
  extendPageContext,
  vikeAppPackageJsonPathEnd,
  cwd,
  serverFsAllow,
}: {
  expressApp: Express
  appContext: TAppContext
  mode: 'production' | 'development'
  publicEnv?: Record<string, string>
  extendPageContext?: (ctx: TAppContext, req: TExpressRerquest) => Promise<TExtendedPageContext>
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
          ...(await extendPageContext?.(appContext, req as any)),
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
