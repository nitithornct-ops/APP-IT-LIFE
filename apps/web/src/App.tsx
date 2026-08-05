import { Route, Routes } from 'react-router-dom';
import { HealthPage } from './pages/HealthPage';
import { HomePage } from './pages/HomePage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/health" element={<HealthPage />} />
    </Routes>
  );
}
