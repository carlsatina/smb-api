import { Request } from 'express'

interface ExtendedRequest extends Request {
    user?: any
    body: any
}

export { ExtendedRequest }