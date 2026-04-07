import MapViewer from './components/MapViewer'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'

export default function App() {
  return (
    <div className="flex flex-col w-full h-full">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {/* MapViewer fills remaining space */}
        <div className="flex-1 relative">
          <MapViewer />
        </div>
      </div>
    </div>
  )
}
