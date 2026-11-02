import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    success: true,
    data: [
      { id: '1', title: 'New device detected', message: 'Device 192.168.1.42 joined the network.', time: '2 min ago' },
      { id: '2', title: 'Scan completed', message: 'Network scan finished: 12 devices found.', time: '15 min ago' },
      { id: '3', title: 'Firewall blocked', message: '3 unauthorized connection attempts blocked.', time: '1 hr ago' },
    ],
  })
}
