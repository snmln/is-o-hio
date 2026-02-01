import './Header.css';

function Header() {
  return (
    <header className="header">
      <div className="header-content">
        <h1 className="header-title">
          <span className="header-icon">🏟️</span>
          Isometric Ohio
        </h1>
        <p className="header-subtitle">OSU Campus in SimCity 2000 Style</p>
      </div>
      <div className="header-links">
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="header-link"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}

export default Header;
