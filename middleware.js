import { NextResponse } from 'next/server'

export function middleware(request) {
  const auth = request.cookies.get('mendel_auth')
  if (!auth || !auth.value.endsWith('@mendel.com')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!login|_next|favicon.ico|og-image.png|mendel_travel.svg).*)'],
}
