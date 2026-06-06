import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import Search from './pages/Search'
import BookDetail from './pages/BookDetail'
import Upload from './pages/Upload'
import Reader from './pages/Reader'
import ArchivistDashboard from './pages/ArchivistDashboard'
import LibrarianDashboard from './pages/LibrarianDashboard'

function AppContent() {
  const { pathname } = useLocation()
  return (
    <>
      {!pathname.startsWith('/read/') && <Navbar />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/book/:arweaveHash" element={<BookDetail />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/read/:arweaveHash" element={<Reader />} />
        <Route path="/dashboard/archivist" element={<ArchivistDashboard />} />
        <Route path="/dashboard/librarian" element={<LibrarianDashboard />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}
