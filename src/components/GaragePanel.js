export class GaragePanel {
  constructor(overlayId, kartsList, onChangeCallback, onCloseCallback, onStudioChangeCallback) {
    this.overlay = document.getElementById(overlayId);
    this.kartsList = kartsList || []; // Array of { driverNum, kartInst }
    this.currentIndex = 0;
    
    this.onChange = onChangeCallback;
    this.onClose = onCloseCallback;
    this.onStudioChange = onStudioChangeCallback;

    // DOM Elements
    this.prevBtn = document.getElementById('garagePrevBtn');
    this.nextBtn = document.getElementById('garageNextBtn');
    this.currentDriverDisplay = document.getElementById('garageCurrentDriver');
    
    this.colorPicker = document.getElementById('garageColorPicker');
    this.resetColorBtn = document.getElementById('garageResetColorBtn');
    
    this.abbrInput = document.getElementById('garageAbbrInput');
    this.numInput = document.getElementById('garageNumInput');
    
    this.compoundBtns = document.querySelectorAll('.compound-btn');
    this.closeBtn = document.getElementById('closeGarageBtn');

    // Studio Settings DOM
    this.lightSlider = document.getElementById('garageLightIntensity');
    this.bloomSlider = document.getElementById('garageBloomIntensity');
    this.baseToggle = document.getElementById('garageShowBase');

    this._setupListeners();
  }

  show(kartsMap) {
    this.overlay.classList.remove('hidden');
    // Convert Map to Array for easy linear navigation
    this.kartsList = Array.from(kartsMap.entries()).map(([num, kart]) => ({ num, kart }));
    this.currentIndex = 0;
    this._loadCurrentKart();
  }

  hide() {
    this.overlay.classList.add('hidden');
  }

  _setupListeners() {
    // Navigation
    this.prevBtn.addEventListener('click', () => {
      if (this.kartsList.length === 0) return;
      this.currentIndex = (this.currentIndex - 1 + this.kartsList.length) % this.kartsList.length;
      this._loadCurrentKart();
      this._notifyChange();
    });

    this.nextBtn.addEventListener('click', () => {
      if (this.kartsList.length === 0) return;
      this.currentIndex = (this.currentIndex + 1) % this.kartsList.length;
      this._loadCurrentKart();
      this._notifyChange();
    });

    // Close
    this.closeBtn.addEventListener('click', () => {
      if (this.onClose) this.onClose();
    });

    // Color
    this.colorPicker.addEventListener('input', (e) => {
      const kart = this._getCurrentKart();
      if (!kart) return;
      kart.setTeamColor(e.target.value);
    });

    this.resetColorBtn.addEventListener('click', () => {
      const kart = this._getCurrentKart();
      if (!kart) return;
      kart.setTeamColor(kart.defaultTeamColor);
      this.colorPicker.value = '#' + (kart.defaultTeamColor || 0).toString(16).padStart(6, '0');
    });

    // Strategy
    this.compoundBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const compound = e.target.dataset.compound;
        const kart = this._getCurrentKart();
        if (kart) {
          kart.setTireCompound(compound);
          this._updateCompoundButtons(compound);
        }
      });
    });

    // Driver details (debounced)
    let timeout = null;
    const updateDetails = () => {
      const kart = this._getCurrentKart();
      if (!kart) return;
      const abbr = this.abbrInput.value || 'AAA';
      const num = parseInt(this.numInput.value) || 1;
      kart.setDriverDetails(abbr, num);
    };

    this.abbrInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(updateDetails, 300);
    });
    
    this.numInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(updateDetails, 300);
    });

    // Studio settings listeners
    this.lightSlider.addEventListener('input', () => this._notifyStudioChange());
    this.bloomSlider.addEventListener('input', () => this._notifyStudioChange());
    this.baseToggle.addEventListener('change', () => this._notifyStudioChange());
  }

  _getCurrentKart() {
    return this.kartsList[this.currentIndex]?.kart;
  }

  _loadCurrentKart() {
    const kart = this._getCurrentKart();
    if (!kart) return;

    this.currentDriverDisplay.textContent = kart.abbreviation;
    
    const hexColor = '#' + (kart.teamColorHex || 0).toString(16).padStart(6, '0');
    this.colorPicker.value = hexColor;

    this.abbrInput.value = kart.abbreviation;
    // Assuming driver.driver_number is stored, if not we extract from text or default
    this.numInput.value = kart.driver ? kart.driver.driver_number : 1;

    this._updateCompoundButtons(kart.tireCompound);
  }

  _updateCompoundButtons(compound) {
    this.compoundBtns.forEach(btn => {
      if (btn.dataset.compound === compound) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });
  }

  _notifyChange() {
    if (this.onChange) {
      this.onChange(this._getCurrentKart());
    }
  }

  _notifyStudioChange() {
    if (this.onStudioChange) {
      this.onStudioChange({
        intensity: parseFloat(this.lightSlider.value),
        bloom: parseFloat(this.bloomSlider.value),
        showBase: this.baseToggle.checked
      });
    }
  }
}
