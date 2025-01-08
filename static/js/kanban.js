// Constants
const API_BASE = 'http://localhost:5000';

// Global variables
let currentNoteTarget = null;
let draggedCard = null;
let originalContainer = null;

function onload() {
    fetch(`${API_BASE}/api/targets`)
        .then(response => response.json())
        .then(targets => {
            // Group targets by status
            const targetsByStatus = {};
            targets.forEach(target => {
                const status = target.status || 'Unknown';
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
                        cardContainer.innerHTML = '';
                        targetsByStatus[status].forEach(target => {
                            const card = document.createElement('div');
                            card.className = 'card';
                            card.id = `card-${target.organization.replace(/[^a-zA-Z0-9]/g, '-')}`;
                            card.dataset.target = JSON.stringify(target);
                            card.innerHTML = createCardContent(target);
                            cardContainer.appendChild(card);

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

            // Set up event listeners
            setupEventListeners();
            
            // Attach drag and drop listeners
            attachCardListeners();
        })
        .catch(error => console.error('Error:', error));
}

function setupEventListeners() {
    // Set up event listeners for activity log
    const activityLogContainer = document.querySelector('.activity-log');
    if (activityLogContainer) {
        activityLogContainer.style.display = 'none';
    }

    // Set up event listener for new note text
    const newNoteText = document.getElementById('newNoteText');
    if (newNoteText) {
        newNoteText.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                addNote();
            }
        });
    }

    // Set up search functionality
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', function(event) {
            if (event.key === 'Enter') {
                searchCards(event.target.value);
            }
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

function attachCardListeners() {
    // Add drag and drop listeners to all cards
    document.querySelectorAll('.card').forEach(card => {
        card.setAttribute('draggable', true);
        card.addEventListener('dragstart', drag);
        card.addEventListener('dragend', dragend);
    });

    // Add drag and drop listeners to all columns
    document.querySelectorAll('.cards-container').forEach(container => {
        container.addEventListener('dragover', allowDrop);
        container.addEventListener('drop', drop);
        container.addEventListener('dragleave', dragleave);
    });
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', onload);

function startAutoScroll(direction, container) {
    if (autoScrollInterval) return;
    
    autoScrollInterval = setInterval(() => {
        if (direction === 'up') {
            container.scrollTop -= 10;
        } else {
            container.scrollTop += 10;
        }
    }, 50);
}

function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
}

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

function drop(event) {
    event.preventDefault();
    event.stopPropagation();
    
    if (!draggedCard) {
        console.error('No dragged card found');
        return;
    }

    const container = event.target.closest('.cards-container');
    if (!container) {
        console.error('No valid drop container found');
        return;
    }

    // Get the new status from the column
    const newStatus = container.closest('.column').id.replace(/-/g, ' ');
    
    // Get the target data
    const targetData = JSON.parse(draggedCard.dataset.target);
    const organization = targetData.organization;
    
    // Update the status on the server
    fetch(`${API_BASE}/api/update_status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            organization: organization,
            status: newStatus
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            throw new Error(data.error);
        }

        // Remove card from old container
        if (draggedCard.parentNode) {
            draggedCard.parentNode.removeChild(draggedCard);
        }

        // Insert the card at the top of the new container
        const firstCard = container.firstChild;
        if (firstCard) {
            container.insertBefore(draggedCard, firstCard);
        } else {
            container.appendChild(draggedCard);
        }
        
        // Update target data with new status
        targetData.status = newStatus;
        draggedCard.dataset.target = JSON.stringify(targetData);
        
        // Update column counts
        updateColumnCounts();
        
        // Log the activity
        loadActivityLog();
        
        // Notify the map to update the marker
        window.parent.postMessage({
            type: 'updateMapPin',
            target: targetData
        }, '*');

        // Remove dragging class
        draggedCard.classList.remove('dragging');
    })
    .catch(error => {
        console.error('Error updating status:', error);
        // Return card to original position if there was an error
        if (originalContainer && draggedCard) {
            originalContainer.appendChild(draggedCard);
        }
        if (draggedCard) {
            draggedCard.classList.remove('dragging');
        }
    });
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now - date) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
        return date.toLocaleTimeString();
    } else {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
}

function loadActivityLog() {
    fetch(`${API_BASE}/api/activity_log`)
        .then(response => response.json())
        .then(activities => {
            const content = document.querySelector('.activity-log-content');
            content.innerHTML = activities.map(activity => `
                <div class="activity-item">
                    <div>${activity.message}</div>
                    <div class="activity-timestamp">${formatTime(activity.timestamp)}</div>
                </div>
            `).join('');
        });
}

function toggleActivityLog() {
    const activityLog = document.querySelector('.activity-log');
    if (activityLog) {
        const isVisible = activityLog.style.display !== 'none';
        activityLog.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            loadActivityLog();
        }
    }
}

function toggleCard(event) {
    if (event.target.classList.contains('sort-button') || 
        event.target.closest('.sort-menu')) {
        return;
    }
    
    const card = event.currentTarget;
    const details = card.querySelector('.card-details');
    
    if (details) {
        card.classList.toggle('expanded');
        details.style.display = details.style.display === 'none' ? 'block' : 'none';
    }
}

function searchCards(searchTerm) {
    const normalizedSearch = searchTerm.toLowerCase();
    let found = false;
    
    // Get all columns
    document.querySelectorAll('.column').forEach(column => {
        const container = column.querySelector('.cards-container');
        const cards = Array.from(container.querySelectorAll('.card'));
        
        // Split cards into matching and non-matching
        const matchingCards = [];
        const nonMatchingCards = [];
        
        cards.forEach(card => {
            const target = JSON.parse(card.dataset.target);
            const searchableText = [
                target.organization,
                target.address,
                target.phone,
                target.website
            ].join(' ').toLowerCase();
            
            if (searchableText.includes(normalizedSearch)) {
                card.classList.add('highlighted');
                card.querySelector('.card-details').style.display = 'block';
                card.classList.add('expanded');
                matchingCards.push(card);
                found = true;
            } else {
                card.classList.remove('highlighted');
                card.querySelector('.card-details').style.display = 'none';
                card.classList.remove('expanded');
                nonMatchingCards.push(card);
            }
        });
        
        // Clear the container
        container.innerHTML = '';
        
        // Add first drop target
        const firstDropTarget = document.createElement('div');
        firstDropTarget.className = 'card-drop-target';
        container.appendChild(firstDropTarget);
        
        // Add matching cards first, then non-matching cards
        [...matchingCards, ...nonMatchingCards].forEach(card => {
            container.appendChild(card);
            const dropTarget = document.createElement('div');
            dropTarget.className = 'card-drop-target';
            container.appendChild(dropTarget);
        });
    });
    
    const searchClear = document.getElementById('searchClear');
    if (searchTerm) {
        searchClear.style.display = 'block';
    } else {
        searchClear.style.display = 'none';
    }
    
    return found;
}

function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    
    searchInput.value = '';
    searchClear.style.display = 'none';
    
    document.querySelectorAll('.card').forEach(card => {
        card.classList.remove('highlighted');
    });
}

function toggleSort(button, columnId) {
    const menu = button.nextElementSibling;
    
    // Close all other sort menus
    document.querySelectorAll('.sort-menu').forEach(otherMenu => {
        if (otherMenu !== menu) {
            otherMenu.classList.remove('visible');
        }
    });
    
    menu.classList.toggle('visible');
}

function handleSort(columnId, sortBy, direction) {
    const column = document.getElementById(columnId);
    const container = column.querySelector('.cards-container');
    const cards = Array.from(container.querySelectorAll('.card'));
    
    cards.sort((a, b) => {
        const targetA = JSON.parse(a.dataset.target);
        const targetB = JSON.parse(b.dataset.target);
        
        let valueA, valueB;
        
        switch (sortBy) {
            case 'organization':
                valueA = targetA.organization.toLowerCase();
                valueB = targetB.organization.toLowerCase();
                break;
            case 'population':
                valueA = parseInt(targetA.population) || 0;
                valueB = parseInt(targetB.population) || 0;
                break;
            case 'income':
                valueA = parseInt(targetA.median_income) || 0;
                valueB = parseInt(targetB.median_income) || 0;
                break;
            default:
                return 0;
        }
        
        if (direction === 'asc') {
            if (valueA < valueB) return -1;
            if (valueA > valueB) return 1;
            return 0;
        } else {
            if (valueA > valueB) return -1;
            if (valueA < valueB) return 1;
            return 0;
        }
    });
    
    // Clear the container
    container.innerHTML = '';
    
    // Add first drop target
    const firstDropTarget = document.createElement('div');
    firstDropTarget.className = 'card-drop-target';
    container.appendChild(firstDropTarget);
    
    // Add sorted cards with drop targets in between
    cards.forEach((card, index) => {
        container.appendChild(card);
        
        // Add drop target after each card
        const dropTarget = document.createElement('div');
        dropTarget.className = 'card-drop-target';
        container.appendChild(dropTarget);
    });
    
    // Close the sort menu
    column.querySelector('.sort-menu').classList.remove('visible');
}

function createCardContent(target) {
    return `
        <div class="card-title">${target.organization}</div>
        <div class="card-details" style="display: none;">
            <div>Address: ${target.address}</div>
            <div>Phone: ${target.phone}</div>
            <div>Website: ${target.website}</div>
            <div>Population: ${target.population}</div>
            <div>Median Income: $${target.median_income}</div>
            <div class="card-footer">
                <button class="notes-button" onclick="event.stopPropagation(); openNotes('${target.organization}')">Notes (0)</button>
                <span class="last-note-time"></span>
            </div>
        </div>
    `;
}

function createPlaceholder() {
    const placeholder = document.createElement('div');
    placeholder.className = 'card placeholder';
    return placeholder;
}

function formatNoteTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.abs(now - date) / (1000 * 60 * 60);
    
    // Format options for different cases
    const timeOptions = { hour: 'numeric', minute: 'numeric', hour12: true };
    const dateOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true };
    
    if (diffInHours < 24) {
        // If less than 24 hours ago, show just the time
        return date.toLocaleTimeString('en-US', timeOptions);
    } else {
        // If more than 24 hours ago, show date and time
        return date.toLocaleString('en-US', dateOptions);
    }
}

function openNotes(organization) {
    currentNoteTarget = organization;
    const notesPopup = document.getElementById('notes-popup');
    const notesTitle = document.getElementById('notes-title');
    
    if (notesPopup && notesTitle) {
        notesPopup.style.display = 'block';
        notesTitle.textContent = `Notes for ${organization}`;
        
        // Clear any existing notes
        const notesList = document.querySelector('.notes-list');
        if (notesList) {
            notesList.innerHTML = '';
        }
        
        // Clear new note text
        const newNoteText = document.getElementById('newNoteText');
        if (newNoteText) {
            newNoteText.value = '';
        }
        
        // Load notes
        loadNotes(organization, false);
    }
}

function closeNotes() {
    const notesPopup = document.getElementById('notes-popup');
    if (notesPopup) {
        notesPopup.style.display = 'none';
        
        // Clear new note text
        const newNoteText = document.getElementById('newNoteText');
        if (newNoteText) {
            newNoteText.value = '';
        }
    }
    currentNoteTarget = null;
}

function loadNotes(organization, isInitialLoad = false) {
    fetch(`${API_BASE}/api/notes/${encodeURIComponent(organization)}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(notes => {
            // Only update the notes list if we're not doing initial load
            if (!isInitialLoad) {
                const notesList = document.querySelector('.notes-list');
                if (notesList) {
                    notesList.innerHTML = notes.map(note => `
                        <div class="note-item" data-id="${note.id}">
                            <div class="note-text">${note.content}</div>
                            <div class="note-timestamp">${formatNoteTime(note.timestamp)}</div>
                            <button class="delete-note" onclick="confirmDeleteNote(${note.id})">×</button>
                        </div>
                    `).join('');
                }
            }
            
            // Update note count and timestamp on the card
            const card = document.querySelector(`#card-${organization.replace(/[^a-zA-Z0-9]/g, '-')}`);
            if (card) {
                const notesButton = card.querySelector('.card-details .notes-button');
                const lastNoteTime = card.querySelector('.last-note-time');
                
                if (notesButton) {
                    notesButton.textContent = `Notes (${notes.length})`;
                }
                
                // Handle collapsed footer
                const collapsedFooter = card.querySelector('.card-footer-collapsed');
                if (notes.length > 0) {
                    // Show the button and timestamp in collapsed state
                    if (!collapsedFooter) {
                        const newCollapsedFooter = document.createElement('div');
                        newCollapsedFooter.className = 'card-footer-collapsed';
                        newCollapsedFooter.innerHTML = `
                            <button class="notes-button" onclick="event.stopPropagation(); openNotes('${organization}')">Notes (${notes.length})</button>
                            <span class="last-note-time">${formatNoteTime(notes[0].timestamp)}</span>
                        `;
                        card.insertBefore(newCollapsedFooter, card.querySelector('.card-details'));
                    } else {
                        const collapsedButton = collapsedFooter.querySelector('.notes-button');
                        const collapsedTime = collapsedFooter.querySelector('.last-note-time');
                        if (collapsedButton) collapsedButton.textContent = `Notes (${notes.length})`;
                        if (collapsedTime) collapsedTime.textContent = formatNoteTime(notes[0].timestamp);
                    }
                    if (lastNoteTime) lastNoteTime.textContent = formatNoteTime(notes[0].timestamp);
                } else {
                    // Remove the collapsed footer if it exists and there are no notes
                    if (collapsedFooter) {
                        collapsedFooter.remove();
                    }
                    if (lastNoteTime) lastNoteTime.textContent = '';
                }
            }
        })
        .catch(error => {
            console.error('Error loading notes:', error);
            // Don't show errors for initial load
            if (!isInitialLoad) {
                alert('Failed to load notes. Please try again.');
            }
        });
}

function addNote() {
    const content = document.getElementById('newNoteText').value.trim();
    if (!content || !currentNoteTarget) return;
    
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
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            console.error('Error adding note:', data.error);
            return;
        }
        document.getElementById('newNoteText').value = '';
        loadNotes(currentNoteTarget);
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to add note. Please try again.');
    });
}

function confirmDeleteNote(noteId) {
    if (confirm('Are you sure you want to delete this note?')) {
        deleteNote(noteId);
    }
}

function deleteNote(noteId) {
    fetch(`${API_BASE}/api/notes/${noteId}`, {
        method: 'DELETE'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            console.error('Error deleting note:', data.error);
            return;
        }
        // Reload notes after successful deletion
        loadNotes(currentNoteTarget);
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to delete note. Please try again.');
    });
}

// Close notes popup when clicking outside
const notesOverlay = document.querySelector('.notes-overlay');
if (notesOverlay) {
    notesOverlay.addEventListener('click', closeNotes);
}

// Prevent closing when clicking inside the popup
const notesPopup = document.querySelector('.notes-popup');
if (notesPopup) {
    notesPopup.addEventListener('click', e => e.stopPropagation());
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
