// Constants
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:5000' : window.location.origin;

// Global variables
let currentNoteTarget = null;
let draggedCard = null;
let originalContainer = null;
let autoScrollInterval = null;
let isSubmittingNote = false; // Flag to prevent duplicate submissions

// Function to create card content
function createCardContent(target) {
    const income = target.median_income ? `$${target.median_income.toLocaleString()}` : 'N/A';
    const population = target.population ? target.population.toLocaleString() : 'N/A';
    const escapedOrg = target.organization.replace(/'/g, "\\'");
    const hasLocation = target.latitude != null && target.longitude != null;
    
    return `
        <div class="card-header">
            <div class="card-title">${target.organization}</div>
            <div class="card-buttons">
                ${hasLocation ? `<button class="locate-btn" onclick="locateOnMap(event, ${target.latitude}, ${target.longitude}, '${escapedOrg}')">📍 Locate</button>` : ''}
                <button onclick="openNotes('${escapedOrg}')">📝</button>
            </div>
        </div>
        <div class="card-details" style="display: none;">
            <p><strong>Address:</strong> ${target.address || 'N/A'}</p>
            <p><strong>Phone:</strong> ${target.phone || 'N/A'}</p>
            <p><strong>Population:</strong> ${population}</p>
            <p><strong>Median Income:</strong> ${income}</p>
            <p><strong>Grade:</strong> ${target.grade || 'N/A'}</p>
        </div>
    `;
}

// Drag and drop functions
function allowDrop(event) {
    event.preventDefault();
    
    // Add drag-over effect to the container
    const container = event.target.closest('.cards-container');
    if (container) {
        // Remove from all containers first
        document.querySelectorAll('.cards-container').forEach(c => {
            c.classList.remove('drag-over');
        });
        // Add to current container
        container.classList.add('drag-over');
    }
}

function dragleave(event) {
    const container = event.target.closest('.cards-container');
    if (container) {
        container.classList.remove('drag-over');
    }
}

function drag(event) {
    draggedCard = event.target;
    originalContainer = draggedCard.parentNode;
    draggedCard.classList.add('dragging');
    
    // Set opacity on other cards
    document.querySelectorAll('.card').forEach(card => {
        if (card !== draggedCard) {
            card.style.opacity = '0.6';
        }
    });
}

function dragend(event) {
    if (draggedCard) {
        draggedCard.classList.remove('dragging');
    }
    
    // Reset opacity on all cards
    document.querySelectorAll('.card').forEach(card => {
        card.style.opacity = '';
    });
    
    // Remove drag-over effect from all containers
    document.querySelectorAll('.cards-container').forEach(container => {
        container.classList.remove('drag-over');
    });
}

async function loadTargets() {
    try {
        const response = await fetch(`${API_BASE}/api/targets`);
        if (!response.ok) {
            const error = await response.text();
            console.error('Server error:', error);
            throw new Error(`Server returned ${response.status}: ${error}`);
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
            console.error('Invalid data format:', data);
            throw new Error('Server returned invalid data format');
        }
        console.log(`Loaded ${data.length} targets`);
        renderTargets(data);
    } catch (e) {
        console.error('Error loading targets:', e);
        // Show error message to user
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.innerHTML = `
            <p>Error loading data: ${e.message}</p>
            <p>Make sure the Flask server is running on port 5000.</p>
            <button onclick="loadTargets()">Retry</button>
        `;
        document.querySelector('.kanban-board').prepend(errorDiv);
    }
}

function renderTargets(targets) {
    // Clear all existing cards first
    document.querySelectorAll('.cards-container').forEach(container => {
        container.innerHTML = '';
    });

    // Group targets by status
    const targetsByStatus = {};
    targets.forEach(target => {
        const status = target.status || 'not-contacted';
        if (!targetsByStatus[status]) {
            targetsByStatus[status] = [];
        }
        targetsByStatus[status].push(target);
    });

    // Create cards for each status
    Object.keys(targetsByStatus).forEach(status => {
        const columnId = status.toLowerCase().replace(/ /g, '-');
        const column = document.getElementById(columnId);
        if (column) {
            const cardContainer = column.querySelector('.cards-container');
            if (cardContainer) {
                targetsByStatus[status].forEach(target => {
                    const card = document.createElement('div');
                    card.className = 'card';
                    card.draggable = true;
                    card.id = `card-${target.organization.replace(/[^a-zA-Z0-9]/g, '-')}`;
                    card.dataset.target = JSON.stringify(target);
                    card.dataset.status = status;
                    card.innerHTML = createCardContent(target);
                    cardContainer.appendChild(card);

                    // Add drag handlers
                    card.addEventListener('dragstart', drag);
                    card.addEventListener('dragend', dragend);

                    // Add click handler for expansion
                    card.addEventListener('click', function(event) {
                        // Don't expand if clicking on a button
                        if (event.target.tagName === 'BUTTON') {
                            return;
                        }
                        const details = this.querySelector('.card-details');
                        if (details) {
                            const isExpanded = details.style.display !== 'none';
                            details.style.display = isExpanded ? 'none' : 'block';
                        }
                    });
                });
            }
        }
    });

    // Update all column counts
    updateColumnCounts();

    // After creating all cards, load notes for each target
    targets.forEach(target => {
        loadNotes(target.organization, true);
    });
}

function attachCardListeners() {
    // Add drag and drop listeners to all cards
    document.querySelectorAll('.card').forEach(card => {
        card.addEventListener('dragstart', drag);
        card.addEventListener('dragend', dragend);
    });

    // Add drop zone listeners to all containers
    document.querySelectorAll('.cards-container').forEach(container => {
        container.addEventListener('dragover', allowDrop);
        container.addEventListener('drop', drop);
        container.addEventListener('dragleave', dragleave);
    });
}

function updateColumnCounts() {
    document.querySelectorAll('.column').forEach(column => {
        const count = column.querySelectorAll('.card').length;
        const countElement = column.querySelector('.column-count');
        if (countElement) {
            countElement.textContent = count;
        }
    });
}

async function updateCardStatus(organization, newStatus) {
    try {
        const response = await fetch(`${API_BASE}/api/update_status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                organization,
                status: newStatus
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to update status');
        }

        // Success! The status has been updated
        return true;
    } catch (error) {
        console.error('Failed to update status:', error);
        if (!navigator.onLine) {
            showOfflineNotification();
        }
        return false;
    }
}

function showOfflineNotification() {
    const notification = document.createElement('div');
    notification.className = 'offline-notification';
    notification.innerHTML = `
        <div class="offline-content">
            <i class="fas fa-wifi-slash"></i>
            Working offline - Changes will sync when connection is restored
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

function openNotes(organization) {
    const notesContainer = document.querySelector('.notes-container');
    notesContainer.style.display = 'block';
    notesContainer.dataset.organization = organization;
    currentNoteTarget = organization;
    
    // Clear and focus input
    const noteInput = document.querySelector('.note-input');
    noteInput.value = '';
    noteInput.focus();
    
    // Initial load of notes
    loadNotes(organization);
}

function loadNotes(organization) {
    const notesList = document.querySelector('.notes-list');
    notesList.innerHTML = '<div class="loading">Loading notes...</div>';
    
    fetch(`${API_BASE}/api/notes/${encodeURIComponent(organization)}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(notes => {
            if (notes.length === 0) {
                notesList.innerHTML = '<div class="no-notes">No notes yet</div>';
                return;
            }
            
            notesList.innerHTML = ''; // Clear loading state
            notes.forEach(note => {
                const noteElement = document.createElement('div');
                noteElement.className = 'note';
                noteElement.innerHTML = `
                    <div class="note-content">${note.content}</div>
                    <div class="note-footer">
                        <span class="note-timestamp">${new Date(note.timestamp).toLocaleString()}</span>
                        <button onclick="deleteNote(${note.id})">Delete</button>
                    </div>
                `;
                notesList.appendChild(noteElement);
            });
        })
        .catch(error => {
            console.error('Error loading notes:', error);
            notesList.innerHTML = '<div class="error">Error loading notes</div>';
        });
}

function addNote() {
    if (isSubmittingNote) return; // Prevent duplicate submissions
    
    const noteInput = document.querySelector('.note-input');
    const content = noteInput.value.trim();
    
    if (!content || !currentNoteTarget) return;
    
    isSubmittingNote = true; // Set flag
    
    // Disable input and button while posting
    noteInput.disabled = true;
    const addButton = document.querySelector('.add-note-btn');
    addButton.disabled = true;
    
    fetch(`${API_BASE}/api/notes`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            target_id: currentNoteTarget,
            content: content
        })
    })
    .then(response => response.json())
    .then(note => {
        noteInput.value = ''; // Clear input
        loadNotes(currentNoteTarget); // Refresh notes display
    })
    .catch(error => {
        console.error('Error adding note:', error);
        alert('Error adding note');
    })
    .finally(() => {
        // Re-enable input and button
        noteInput.disabled = false;
        addButton.disabled = false;
        noteInput.focus();
        isSubmittingNote = false; // Reset flag
    });
}

function deleteNote(noteId) {
    if (!confirm('Are you sure you want to delete this note?')) return;
    
    const organization = document.querySelector('.notes-container').dataset.organization;
    
    fetch(`${API_BASE}/api/notes/${noteId}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(result => {
        if (result.success) {
            loadNotes(organization); // Only refresh on successful delete
        } else {
            throw new Error(result.error || 'Failed to delete note');
        }
    })
    .catch(error => {
        console.error('Error deleting note:', error);
        alert('Error deleting note');
    });
}

function setupEventListeners() {
    // Setup search input event listener
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        // Clear old event listeners
        const newSearchInput = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newSearchInput, searchInput);
        
        // Add input event listener
        newSearchInput.addEventListener('input', (e) => {
            searchCards(e.target.value);
        });
        
        // Add keydown event for Enter key
        newSearchInput.addEventListener('keydown', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault(); // Prevent form submission if in a form
                searchCards(this.value);
            }
        });
    }
    
    // Setup clear search button
    const clearSearchBtn = document.getElementById('clearSearch');
    if (clearSearchBtn) {
        const newClearBtn = clearSearchBtn.cloneNode(true);
        clearSearchBtn.parentNode.replaceChild(newClearBtn, clearSearchBtn);
        newClearBtn.addEventListener('click', clearSearch);
    }

    // Set up event listeners for activity log
    const activityLogContainer = document.querySelector('.activity-log');
    if (activityLogContainer) {
        activityLogContainer.style.display = 'none';
    }

    // Remove any existing event listeners
    const noteInput = document.querySelector('.note-input');
    const addNoteButton = document.querySelector('.add-note-btn');
    
    if (noteInput) {
        const oldInput = noteInput.cloneNode(true);
        noteInput.parentNode.replaceChild(oldInput, noteInput);
        
        oldInput.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                addNote();
            }
        });
    }
    
    if (addNoteButton) {
        const oldButton = addNoteButton.cloneNode(true);
        addNoteButton.parentNode.replaceChild(oldButton, addNoteButton);
        
        oldButton.addEventListener('click', function(event) {
            event.preventDefault();
            addNote();
        });
    }

    // Close sort menus when clicking outside
    document.addEventListener('click', function(event) {
        if (!event.target.closest('.sort-button-container')) {
            document.querySelectorAll('.sort-menu').forEach(menu => {
                menu.classList.remove('visible');
            });
        }
    });
}

function searchCards(query) {
    const input = document.getElementById('searchInput');
    if (input) {
        if (!query) {
            // If search is empty, show all cards
            document.querySelectorAll('.card').forEach(card => {
                card.style.display = '';
            });
            updateColumnCounts();
            return;
        }

        query = query.toLowerCase();
        
        // Search through all cards
        document.querySelectorAll('.card').forEach(card => {
            try {
                const targetData = JSON.parse(card.dataset.target);
                const searchableFields = [
                    targetData.organization,
                    targetData.address,
                    targetData.phone,
                    targetData.grade,
                    targetData.status
                ].map(field => (field || '').toString().toLowerCase());
                
                // Show card if any field matches the query
                const matches = searchableFields.some(field => field.includes(query));
                card.style.display = matches ? '' : 'none';
            } catch (error) {
                console.error('Error parsing card data:', error);
                card.style.display = '';  // Show card if there's an error
            }
        });
        
        // Update column counts to reflect visible cards
        updateColumnCounts();
    }
}

function clearSearch() {
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = '';
        searchCards('');
    }
}

// Sorting functions
function toggleSort(columnId) {
    const menu = document.querySelector(`#${columnId} .sort-menu`);
    const allMenus = document.querySelectorAll('.sort-menu');
    
    // Hide all other menus
    allMenus.forEach(m => {
        if (m !== menu) {
            m.classList.remove('visible');
        }
    });
    
    // Toggle current menu
    menu.classList.toggle('visible');
    
    // Close menu when clicking outside
    document.addEventListener('click', function closeMenu(e) {
        if (!e.target.closest('.sort-button-container')) {
            menu.classList.remove('visible');
            document.removeEventListener('click', closeMenu);
        }
    });
}

function sortColumn(columnId, sortKey) {
    const container = document.querySelector(`#${columnId} .cards-container`);
    const cards = Array.from(container.children);
    
    cards.sort((a, b) => {
        const dataA = JSON.parse(a.dataset.target);
        const dataB = JSON.parse(b.dataset.target);
        
        let valA = dataA[sortKey];
        let valB = dataB[sortKey];
        
        // Handle numeric values
        if (sortKey === 'population' || sortKey === 'median_income') {
            valA = Number(valA) || 0;
            valB = Number(valB) || 0;
        } else {
            // Handle string values
            valA = (valA || '').toString().toLowerCase();
            valB = (valB || '').toString().toLowerCase();
        }
        
        if (valA < valB) return -1;
        if (valA > valB) return 1;
        return 0;
    });
    
    // Clear and re-append sorted cards
    container.innerHTML = '';
    cards.forEach(card => container.appendChild(card));
    
    // Hide the sort menu
    document.querySelector(`#${columnId} .sort-menu`).classList.remove('visible');
}

async function drop(event) {
    event.preventDefault();
    
    // Remove drag-over effect from all containers
    document.querySelectorAll('.cards-container').forEach(container => {
        container.classList.remove('drag-over');
    });
    
    if (!draggedCard) return;
    
    const cardData = JSON.parse(draggedCard.dataset.target);
    const container = event.target.closest('.cards-container');
    if (!container) return;
    
    const newStatus = container.parentElement.id;
    const oldStatus = draggedCard.dataset.status;
    
    if (newStatus === oldStatus) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/update_status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                organization: cardData.organization,
                status: newStatus
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to update status');
        }
        
        // Update card's visual state
        draggedCard.dataset.status = newStatus;
        draggedCard.dataset.target = JSON.stringify({
            ...cardData,
            status: newStatus
        });
        
        // Move the card
        container.appendChild(draggedCard);
        
        // Update column counts
        updateColumnCounts();
        
        // Log the change
        const activityLog = document.getElementById('activityLog');
        if (activityLog) {
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry';
            logEntry.innerHTML = `
                <span class="timestamp">${new Date().toLocaleTimeString()}</span>
                <span class="description">Moved "${cardData.organization}" from ${oldStatus} to ${newStatus}</span>
            `;
            activityLog.insertBefore(logEntry, activityLog.firstChild);
        }

        // Notify map if we're in an iframe
        if (window !== window.parent) {
            window.parent.postMessage({
                type: 'updateMapPin',
                target: {
                    ...cardData,
                    status: newStatus
                }
            }, '*');
        }
        
    } catch (error) {
        console.error('Error updating status:', error);
        // Move card back to original position if update fails
        if (originalContainer) {
            originalContainer.appendChild(draggedCard);
        }
        if (!navigator.onLine) {
            showOfflineNotification();
        }
    }
    
    draggedCard = null;
    originalContainer = null;
}

function closeNotes() {
    const notesContainer = document.querySelector('.notes-container');
    notesContainer.style.display = 'none';
    currentNoteTarget = null;
}

function locateOnMap(event, lat, lng, name) {
    event.stopPropagation(); // Prevent card expansion
    if (!lat || !lng) {
        alert('Location coordinates not available for this target.');
        return;
    }
    
    // Send message to parent window (index_db.html) to locate the target
    window.parent.postMessage({
        type: 'locateTarget',
        data: {
            lat: lat,
            lng: lng,
            name: name
        }
    }, '*');
}

async function onload() {
    await loadTargets();
    
    // Set up event listeners
    setupEventListeners();
    
    // Attach drag and drop listeners
    attachCardListeners();
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', onload);

// Listen for messages from the map iframe
window.addEventListener('message', function(event) {
    if (event.data.type === 'closeMap') {
        const mapFrame = document.getElementById('mapFrame');
        if (mapFrame) {
            mapFrame.style.display = 'none';
        }
    }
});

// Check connection and process updates periodically
setInterval(() => {
    if (navigator.onLine) {
        // Removed processPendingUpdates call
    }
}, 30000); // Every 30 seconds
