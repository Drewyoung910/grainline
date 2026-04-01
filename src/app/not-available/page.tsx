import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Not Available in Your Region — Grainline',
  robots: { index: false },
}

export default function NotAvailablePage() {
  return (
    <main className='min-h-screen flex items-center justify-center px-4 bg-stone-50'>
      <div className='text-center max-w-md'>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src='/logo.svg'
          alt='Grainline'
          className='h-8 w-auto mx-auto mb-8'
          style={{ filter: 'brightness(0)' }}
        />
        <h1 className='text-2xl font-semibold text-neutral-900 mb-3'>
          Not available in your region
        </h1>
        <p className='text-neutral-500 text-sm leading-relaxed mb-6'>
          Grainline is currently only available in the United States and Canada.
          We are a local handmade woodworking marketplace focused on connecting
          buyers and makers in North America.
        </p>
        <p className='text-neutral-400 text-xs'>
          Are you a US or Canadian maker or buyer? Make sure you are not using a VPN.
        </p>
      </div>
    </main>
  )
}
