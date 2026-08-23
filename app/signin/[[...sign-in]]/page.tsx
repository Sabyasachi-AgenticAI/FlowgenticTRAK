import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'
import { TrakMark } from '../../trak-mark'
import '../../landing.css'

export default function SignInPage() {
  return (
    <div className="si-page">
      <div className="ld-mark">
        <TrakMark size={28} />
        <span className="ld-mark-flow">Flowgentic</span>
        <span className="ld-mark-trak">TRAK</span>
      </div>
      <SignIn />
      <Link href="/" className="si-back">← Back to flowgentic-trak</Link>
    </div>
  )
}
