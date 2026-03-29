class AppStorage {
    constructor() {
        this.cache = {};
        this.useRemote = true;
        this.pendingSave = null;
        this.saveTimer = null;
    }

    async init() {
        try {
            const response = await fetch('/api/state', {
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to load state: ${response.status}`);
            }

            const payload = await response.json();
            this.cache = payload && payload.state && typeof payload.state === 'object' ? payload.state : {};

            const browserCache = this.readBrowserStorage();
            if (Object.keys(this.cache).length === 0 && Object.keys(browserCache).length > 0) {
                this.cache = browserCache;
                await this.flush();
            }
        } catch (error) {
            console.warn('Falling back to browser storage.', error);
            this.useRemote = false;
            this.cache = this.readBrowserStorage();
        }
    }

    readBrowserStorage() {
        const fallback = {};
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key) {
                fallback[key] = window.localStorage.getItem(key);
            }
        }
        return fallback;
    }

    get length() {
        return Object.keys(this.cache).length;
    }

    key(index) {
        return Object.keys(this.cache)[index] || null;
    }

    getItem(key) {
        return Object.prototype.hasOwnProperty.call(this.cache, key) ? this.cache[key] : null;
    }

    setItem(key, value) {
        this.cache[key] = String(value);

        if (this.useRemote) {
            this.queueSave();
        } else {
            window.localStorage.setItem(key, String(value));
        }
    }

    removeItem(key) {
        delete this.cache[key];

        if (this.useRemote) {
            this.queueSave();
        } else {
            window.localStorage.removeItem(key);
        }
    }

    clear() {
        this.cache = {};

        if (this.useRemote) {
            this.queueSave();
        } else {
            window.localStorage.clear();
        }
    }

    queueSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.pendingSave = this.flush();
        }, 250);
    }

    async flush() {
        try {
            await fetch('/api/state', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ state: this.cache })
            });
        } catch (error) {
            console.error('Failed to persist remote state.', error);
        }
    }
}

class RecipeApp {
    constructor(storage) {
        this.storage = storage;
        this.recipes = this.loadRecipes();
        this.prepList = this.loadPrepList();
        this.prepListName = this.loadPrepListName();
        this.initializeApp();
    }

    initializeApp() {
        this.bindEvents();
        this.displayRecipes();
        this.displayPrepList();
        this.displayPrepListName();
    }

    bindEvents() {
        const form = document.getElementById('recipe-form');
        form.addEventListener('submit', (e) => this.handleFormSubmit(e));

        const clearPrepBtn = document.getElementById('clear-prep-list');
        clearPrepBtn.addEventListener('click', () => this.clearPrepList());

        const printPrepBtn = document.getElementById('print-prep-list');
        printPrepBtn.addEventListener('click', () => this.printPrepList());

        const uncheckAllBtn = document.getElementById('uncheck-all-ingredients');
        uncheckAllBtn.addEventListener('click', () => this.uncheckAllIngredients());

        // Import/Export functionality
        const exportBtn = document.getElementById('export-recipes');
        exportBtn.addEventListener('click', () => this.exportRecipes());

        const importBtn = document.getElementById('import-recipes');
        importBtn.addEventListener('click', () => this.triggerImport());

        const importFile = document.getElementById('import-file');
        importFile.addEventListener('change', (e) => this.importRecipes(e));

        // Search functionality
        const searchInput = document.getElementById('search-input');
        searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));

        // Go to Prep List functionality
        const goToPrepBtn = document.getElementById('go-to-prep-list');
        goToPrepBtn.addEventListener('click', () => this.scrollToPrepList());

        // Go to Search functionality
        const goToSearchBtn = document.getElementById('go-to-search');
        goToSearchBtn.addEventListener('click', () => this.scrollToSearch());

        // Add event listener for name input to update heading dynamically
        const nameInput = document.getElementById('prep-list-name');
        nameInput.addEventListener('input', () => this.updatePrepListHeading());

        // Edit modal events
        const editForm = document.getElementById('edit-recipe-form');
        editForm.addEventListener('submit', (e) => this.handleEditSubmit(e));

        const closeModal = document.querySelector('.close-modal');
        closeModal.addEventListener('click', () => this.closeEditModal());

        const cancelEdit = document.getElementById('cancel-edit');
        cancelEdit.addEventListener('click', () => this.closeEditModal());

        // Close modal when clicking outside
        const modal = document.getElementById('edit-modal');
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeEditModal();
            }
        });
    }

    handleFormSubmit(e) {
        e.preventDefault();
        
        const recipeName = document.getElementById('recipe-name').value.trim();
        const ingredientsText = document.getElementById('ingredients').value.trim();
        
        if (!recipeName || !ingredientsText) {
            alert('Please fill in both recipe name and ingredients!');
            return;
        }

        const ingredients = ingredientsText
            .split('\n')
            .map(ingredient => ingredient.trim())
            .filter(ingredient => ingredient.length > 0);

        if (ingredients.length === 0) {
            alert('Please add at least one ingredient!');
            return;
        }

        const recipe = {
            id: Date.now(),
            name: recipeName,
            ingredients: ingredients.map(ingredient => ({
                text: ingredient,
                checked: false
            }))
        };

        this.addRecipe(recipe);
        this.clearForm();
    }

    addRecipe(recipe) {
        this.recipes.push(recipe);
        this.saveRecipes();
        this.displayRecipes();
    }

    deleteRecipe(recipeId) {
        if (confirm('Are you sure you want to delete this recipe?')) {
            this.recipes = this.recipes.filter(recipe => recipe.id !== recipeId);
            this.saveRecipes();
            this.displayRecipes();
        }
    }

    toggleIngredient(recipeId, ingredientIndex) {
        const recipe = this.recipes.find(r => r.id === recipeId);
        if (recipe) {
            recipe.ingredients[ingredientIndex].checked = !recipe.ingredients[ingredientIndex].checked;
            this.saveRecipes();
            this.refreshCurrentView();
        }
    }

    selectAllIngredients(recipeId) {
        const recipe = this.recipes.find(r => r.id === recipeId);
        if (recipe) {
            // Check if all ingredients are already selected
            const allSelected = recipe.ingredients.every(ingredient => ingredient.checked);
            
            // If all are selected, unselect all; otherwise, select all
            recipe.ingredients.forEach(ingredient => {
                ingredient.checked = !allSelected;
            });
            
            this.saveRecipes();
            this.refreshCurrentView();
        }
    }

    displayRecipes() {
        const container = document.getElementById('recipes-container');
        
        if (this.recipes.length === 0) {
            container.innerHTML = '<p class="no-recipes">No recipes saved yet. Add your first recipe above!</p>';
            return;
        }

        container.innerHTML = this.recipes.map(recipe => this.createRecipeHTML(recipe)).join('');
        
        // Bind events for checkboxes and delete buttons
        this.bindRecipeEvents();
    }

    createRecipeHTML(recipe) {
        const ingredientsList = recipe.ingredients.map((ingredient, index) => `
            <li class="ingredient-item">
                <input 
                    type="checkbox" 
                    class="ingredient-checkbox" 
                    data-recipe-id="${recipe.id}" 
                    data-ingredient-index="${index}"
                    ${ingredient.checked ? 'checked' : ''}
                >
                <span class="ingredient-text ${ingredient.checked ? 'checked' : ''}">${ingredient.text}</span>
            </li>
        `).join('');

        const isInPrepList = this.prepList && this.prepList.includes(recipe.id);

        return `
            <div class="recipe-card">
                <h3 class="recipe-title">${recipe.name}</h3>
                <div class="recipe-controls">
                    <button class="select-all-btn" data-recipe-id="${recipe.id}">☑️ Select All</button>
                </div>
                <ul class="ingredients-list">
                    ${ingredientsList}
                </ul>
                <div class="recipe-actions">
                    <button class="edit-recipe" data-recipe-id="${recipe.id}">✏️ Edit</button>
                    <button class="prep-list-btn ${isInPrepList ? 'in-prep-list' : ''}" data-recipe-id="${recipe.id}">
                        ${isInPrepList ? '✓ In Prep List' : '📋 Add to Prep List'}
                    </button>
                    <button class="delete-recipe" data-recipe-id="${recipe.id}">Delete Recipe</button>
                </div>
            </div>
        `;
    }

    bindRecipeEvents() {
        // Bind checkbox events
        document.querySelectorAll('.ingredient-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const recipeId = parseInt(e.target.dataset.recipeId);
                const ingredientIndex = parseInt(e.target.dataset.ingredientIndex);
                this.toggleIngredient(recipeId, ingredientIndex);
            });
        });

        // Bind delete button events
        document.querySelectorAll('.delete-recipe').forEach(button => {
            button.addEventListener('click', (e) => {
                const recipeId = parseInt(e.target.dataset.recipeId);
                this.deleteRecipe(recipeId);
            });
        });

        // Bind prep list button events
        document.querySelectorAll('.prep-list-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const recipeId = parseInt(e.target.dataset.recipeId);
                this.togglePrepList(recipeId);
            });
        });

        // Bind edit button events
        document.querySelectorAll('.edit-recipe').forEach(button => {
            button.addEventListener('click', (e) => {
                const recipeId = parseInt(e.target.dataset.recipeId);
                this.openEditModal(recipeId);
            });
        });

        // Bind select all button events
        document.querySelectorAll('.select-all-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const recipeId = parseInt(e.target.dataset.recipeId);
                this.selectAllIngredients(recipeId);
            });
        });
    }

    clearForm() {
        document.getElementById('recipe-name').value = '';
        document.getElementById('ingredients').value = '';
    }

    saveRecipes() {
        this.storage.setItem('recipes', JSON.stringify(this.recipes));
    }

    loadRecipes() {
        const saved = this.storage.getItem('recipes');
        return saved ? JSON.parse(saved) : [];
    }

    // Prep List Methods
    togglePrepList(recipeId) {
        const index = this.prepList.indexOf(recipeId);
        if (index === -1) {
            this.prepList.push(recipeId);
        } else {
            this.prepList.splice(index, 1);
        }
        this.autoSavePrepList(); // Use auto-save instead of full save
        this.clearSearch(); // Clear search when adding/removing from prep list
        this.displayRecipes(); // Refresh to update button states
        this.displayPrepList();
    }

    clearPrepList() {
        if (this.prepList.length === 0) {
            alert('Prep list is already empty!');
            return;
        }
        
        if (confirm(`Clear all ${this.prepList.length} recipes from prep list?`)) {
            this.prepList = [];
            this.autoSavePrepList(); // Use auto-save instead of full save to avoid prompt
            this.displayRecipes(); // Refresh to update button states
            this.displayPrepList();
        }
    }

    printPrepList() {
        if (this.prepList.length === 0) {
            alert('No recipes in prep list to print!');
            return;
        }

        const prepRecipes = this.recipes.filter(recipe => this.prepList.includes(recipe.id));
        
        // Calculate total servings and create organized sections
        let leftColumnRecipes = [];
        let rightColumnRecipes = [];
        
        // Split recipes into two columns for better layout
        prepRecipes.forEach((recipe, index) => {
            if (index % 2 === 0) {
                leftColumnRecipes.push(recipe);
            } else {
                rightColumnRecipes.push(recipe);
            }
        });

        // Create print styles and content
        const printContent = `
            <html>
                <head>
                    <title>Peri Peri Catering - Prep List</title>
                    <style>
                        @page {
                            margin: 0.5in;
                            size: A4;
                        }
                        
                        body {
                            font-family: Arial, sans-serif;
                            margin: 0;
                            padding: 20px;
                            font-size: 18px;
                            line-height: 1.4;
                        }
                        
                        .prep-list-name-header {
                            text-align: center;
                            margin-bottom: 20px;
                            padding: 15px;
                            background-color: #f8f9fa;
                            border: 2px solid #d2691e;
                            border-radius: 8px;
                        }
                        
                        .prep-list-name-header h1 {
                            margin: 0;
                            font-size: 36px;
                            font-weight: bold;
                            color: #d2691e;
                            text-transform: uppercase;
                            letter-spacing: 2px;
                        }
                        
                        .header {
                            text-align: center;
                            margin-bottom: 20px;
                            border-bottom: 2px solid #333;
                            padding-bottom: 10px;
                        }
                        
                        .company-name {
                            font-size: 30px;
                            font-weight: bold;
                            color: #d2691e;
                            margin-bottom: 5px;
                        }
                        
                        .prep-info {
                            display: flex;
                            justify-content: space-between;
                            margin-bottom: 15px;
                            font-weight: bold;
                            font-size: 22px;
                        }
                        
                        .columns {
                            display: flex;
                            gap: 20px;
                        }
                        
                        .column {
                            flex: 1;
                        }
                        
                        .recipe-section {
                            margin-bottom: 20px;
                            border: 1px solid #ccc;
                            padding: 12px;
                            page-break-inside: avoid;
                        }
                        
                        .recipe-title {
                            font-size: 24px;
                            font-weight: bold;
                            margin-bottom: 10px;
                            color: #2c5f2d;
                            border-bottom: 1px solid #2c5f2d;
                            padding-bottom: 4px;
                        }
                        
                        .ingredient-list {
                            list-style: none;
                            padding: 0;
                            margin: 0;
                        }
                        
                        .ingredient-item {
                            display: flex;
                            align-items: flex-start;
                            margin-bottom: 4px;
                            padding: 3px 0;
                        }
                        
                        .checkbox {
                            width: 28px;
                            height: 28px;
                            border: 1px solid #333;
                            margin-right: 10px;
                            margin-top: 2px;
                            flex-shrink: 0;
                        }
                        
                        .ingredient-text {
                            flex: 1;
                            font-size: 21px;
                            line-height: 1.3;
                        }
                        
                        .quantity {
                            font-weight: bold;
                            margin-left: auto;
                            padding-left: 10px;
                            min-width: 60px;
                            text-align: right;
                            font-size: 16px;
                        }
                        
                        @media print {
                            body { 
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                            }
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div class="company-name">Peri Peri Food Loading</div>
                        <div class="prep-info">
                            <span><strong>Prep List ${document.getElementById('prep-list-name')?.value || this.prepListName || 'Guest'}</strong></span>
                        </div>
                        </div>
                    </div>
                    
                    <div class="columns">
                        <div class="column">
                            ${this.generateRecipeColumn(leftColumnRecipes)}
                        </div>
                        <div class="column">
                            ${this.generateRecipeColumn(rightColumnRecipes)}
                        </div>
                    </div>
                </body>
            </html>
        `;

        // Create a new window for printing (simpler and more reliable approach)
        const printWindow = window.open('', '_blank', 'width=800,height=600');
        printWindow.document.write(printContent);
        printWindow.document.close();
        
        // Wait for content to load, then print and close
        printWindow.onload = function() {
            printWindow.print();
            printWindow.onafterprint = function() {
                printWindow.close();
            };
        };
    }

    generateRecipeColumn(recipes) {
        return recipes.map(recipe => {
            // Only include checked ingredients
            const checkedIngredients = recipe.ingredients.filter(ingredient => ingredient.checked);
            
            if (checkedIngredients.length === 0) {
                return `
                    <div class="recipe-section">
                        <div class="recipe-title">${recipe.name}</div>
                    </div>
                `;
            }
            
            return `
                <div class="recipe-section">
                    <div class="recipe-title">${recipe.name}</div>
                    <ul class="ingredient-list">
                        ${checkedIngredients.map(ingredient => `
                            <li class="ingredient-item">
                                <div class="checkbox"></div>
                                <span class="ingredient-text">${ingredient.text}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }).join('');
    }

    displayPrepList() {
        const container = document.getElementById('prep-list-container');
        
        if (this.prepList.length === 0) {
            container.innerHTML = '<p class="no-prep-items">No recipes in prep list. Add recipes using the "📋 Add to Prep List" buttons above!</p>';
            return;
        }

        const prepRecipes = this.recipes.filter(recipe => this.prepList.includes(recipe.id));
        const prepListHTML = prepRecipes.map(recipe => {
            // Only include checked ingredients
            const checkedIngredients = recipe.ingredients.filter(ingredient => ingredient.checked);
            
            if (checkedIngredients.length === 0) {
                return `
                    <div class="prep-recipe-card">
                        <h4 class="prep-recipe-title">${recipe.name}</h4>
                        <p class="no-checked-ingredients">No ingredients selected for this recipe</p>
                        <button class="remove-from-prep" data-recipe-id="${recipe.id}">Remove</button>
                    </div>
                `;
            }

            const ingredientsList = checkedIngredients.map(ingredient => `
                <li class="prep-ingredient">${ingredient.text}</li>
            `).join('');

            return `
                <div class="prep-recipe-card">
                    <h4 class="prep-recipe-title">${recipe.name}</h4>
                    <ul class="prep-ingredients-list">
                        ${ingredientsList}
                    </ul>
                    <button class="remove-from-prep" data-recipe-id="${recipe.id}">Remove</button>
                </div>
            `;
        }).join('');

        container.innerHTML = prepListHTML;
        this.bindPrepListEvents();
    }

    bindPrepListEvents() {
        document.querySelectorAll('.remove-from-prep').forEach(button => {
            button.addEventListener('click', (e) => {
                const recipeId = parseInt(e.target.dataset.recipeId);
                this.togglePrepList(recipeId);
            });
        });
    }

    savePrepList() {
        const guestName = this.prepListName || 'Default';
        const guestPrepLists = this.getGuestPrepLists(guestName);
        
        // Get the complete recipe data for prep list items, including ingredient selections
        const prepRecipes = this.recipes.filter(recipe => this.prepList.includes(recipe.id));
        const prepListData = prepRecipes.map(recipe => ({
            id: recipe.id,
            name: recipe.name,
            ingredients: recipe.ingredients.map(ingredient => ({
                text: ingredient.text,
                checked: ingredient.checked
            }))
        }));
        
        // Prompt for a custom prep list name
        const customName = prompt(`Enter a name for this prep list (for ${guestName}):`, `${guestName} - Prep List ${guestPrepLists.length + 1}`);
        
        if (customName === null) {
            // User cancelled
            return;
        }
        
        const prepListName = customName.trim() || `${guestName} - Prep List ${guestPrepLists.length + 1}`;
        
        // Create a new prep list entry with timestamp and complete recipe data
        const prepListEntry = {
            id: Date.now(),
            name: prepListName, // Use the custom name instead of guest name
            items: [...this.prepList], // Keep recipe IDs for backward compatibility
            recipes: prepListData, // Store complete recipe data with ingredient selections
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        // Add to guest's prep lists
        guestPrepLists.push(prepListEntry);
        
        // Save to localStorage
        this.storage.setItem(`guestPrepLists_${guestName}`, JSON.stringify(guestPrepLists));
        
        // Also save current prep list for backward compatibility
        this.storage.setItem('prepList', JSON.stringify(this.prepList));
        
        alert(`Prep list "${prepListName}" saved successfully!`);
    }

    // Auto-save method for temporary storage without prompting for name
    autoSavePrepList() {
        // Just save the current prep list to localStorage for temporary storage
        this.storage.setItem('prepList', JSON.stringify(this.prepList));
    }

    loadPrepList() {
        const saved = this.storage.getItem('prepList');
        return saved ? JSON.parse(saved) : [];
    }

    getGuestPrepLists(guestName) {
        const saved = this.storage.getItem(`guestPrepLists_${guestName}`);
        return saved ? JSON.parse(saved) : [];
    }

    loadGuestPrepList(guestName, prepListId) {
        console.log('loadGuestPrepList called with:', guestName, prepListId);
        const guestPrepLists = this.getGuestPrepLists(guestName);
        console.log('Found guest prep lists:', guestPrepLists);
        
        const prepList = guestPrepLists.find(list => list.id === prepListId);
        console.log('Found specific prep list:', prepList);
        
        if (prepList) {
            // If the prep list has saved recipe data, use it
            if (prepList.recipes && prepList.recipes.length > 0) {
                console.log('Using saved recipe data');
                this.displaySavedPrepList(prepList.recipes);
            } else {
                // Fallback to old method for backward compatibility
                console.log('Using fallback method with items:', prepList.items);
                this.prepList = [...prepList.items];
                this.displayPrepList();
            }
            return true;
        }
        console.log('Prep list not found');
        return false;
    }

    displaySavedPrepList(savedRecipes) {
        const container = document.getElementById('prep-list-container');
        
        if (savedRecipes.length === 0) {
            container.innerHTML = '<p class="no-prep-items">No recipes in this saved prep list.</p>';
            return;
        }

        const prepListHTML = savedRecipes.map(recipe => {
            // Only include checked ingredients
            const checkedIngredients = recipe.ingredients.filter(ingredient => ingredient.checked);
            
            if (checkedIngredients.length === 0) {
                return `
                    <div class="prep-recipe-card saved-recipe">
                        <h4 class="prep-recipe-title">${recipe.name}</h4>
                        <p class="no-checked-ingredients">No ingredients were selected for this recipe</p>
                    </div>
                `;
            }

            const ingredientsList = checkedIngredients.map(ingredient => `
                <li class="prep-ingredient">${ingredient.text}</li>
            `).join('');

            return `
                <div class="prep-recipe-card saved-recipe">
                    <h4 class="prep-recipe-title">${recipe.name}</h4>
                    <ul class="prep-ingredients-list">
                        ${ingredientsList}
                    </ul>
                </div>
            `;
        }).join('');

        container.innerHTML = prepListHTML;
        
        // Add a note that this is a saved prep list
        const noteElement = document.createElement('div');
        noteElement.className = 'saved-prep-note';
        noteElement.innerHTML = '<p><em>📋 This is a saved prep list. The recipes and ingredients shown are from when this list was saved.</em></p>';
        container.insertBefore(noteElement, container.firstChild);
    }

    // Edit Recipe Methods
    openEditModal(recipeId) {
        const recipe = this.recipes.find(r => r.id === recipeId);
        if (!recipe) return;

        this.currentEditingId = recipeId;
        
        // Populate form with current recipe data
        document.getElementById('edit-recipe-name').value = recipe.name;
        document.getElementById('edit-ingredients').value = recipe.ingredients.map(ing => ing.text).join('\n');
        
        // Show modal
        document.getElementById('edit-modal').style.display = 'block';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }

    closeEditModal() {
        document.getElementById('edit-modal').style.display = 'none';
        document.body.style.overflow = 'auto'; // Restore scrolling
        this.currentEditingId = null;
        
        // Clear form
        document.getElementById('edit-recipe-name').value = '';
        document.getElementById('edit-ingredients').value = '';
    }

    handleEditSubmit(e) {
        e.preventDefault();
        
        const name = document.getElementById('edit-recipe-name').value.trim();
        const ingredientsText = document.getElementById('edit-ingredients').value.trim();
        
        if (!name || !ingredientsText) {
            alert('Please fill in both recipe name and ingredients!');
            return;
        }

        const ingredientLines = ingredientsText.split('\n').filter(line => line.trim());
        if (ingredientLines.length === 0) {
            alert('Please add at least one ingredient!');
            return;
        }

        // Find the recipe to edit
        const recipeIndex = this.recipes.findIndex(r => r.id === this.currentEditingId);
        if (recipeIndex === -1) return;

        // Update the recipe while preserving existing checked states where possible
        const oldIngredients = this.recipes[recipeIndex].ingredients;
        const newIngredients = ingredientLines.map(line => {
            const text = line.trim();
            // Try to find existing ingredient with same text to preserve checked state
            const existingIngredient = oldIngredients.find(ing => ing.text === text);
            return {
                text: text,
                checked: existingIngredient ? existingIngredient.checked : false
            };
        });

        this.recipes[recipeIndex] = {
            ...this.recipes[recipeIndex],
            name: name,
            ingredients: newIngredients
        };

        this.saveRecipes();
        this.displayRecipes();
        this.displayPrepList(); // Update prep list in case recipe name changed
        this.closeEditModal();
    }

    handleSearch(searchTerm) {
        const container = document.getElementById('recipes-container');
        const searchLower = searchTerm.toLowerCase().trim();
        
        if (searchLower === '') {
            // Show all recipes if search is empty
            this.displayRecipes();
            return;
        }

        const filteredRecipes = this.recipes.filter(recipe => {
            // Search in recipe name
            const nameMatch = recipe.name.toLowerCase().includes(searchLower);
            
            // Search in ingredients
            const ingredientMatch = recipe.ingredients.some(ingredient => 
                ingredient.text.toLowerCase().includes(searchLower)
            );
            
            return nameMatch || ingredientMatch;
        });

        if (filteredRecipes.length === 0) {
            container.innerHTML = `<p class="no-recipes">No recipes found matching "${searchTerm}"</p>`;
        } else {
            container.innerHTML = filteredRecipes.map(recipe => this.createRecipeHTML(recipe)).join('');
            this.bindRecipeEvents();
        }
    }

    clearSearch() {
        const searchInput = document.getElementById('search-input');
        searchInput.value = '';
        this.displayRecipes(); // Show all recipes
    }

    refreshCurrentView() {
        const searchInput = document.getElementById('search-input');
        const currentSearchTerm = searchInput.value.trim();
        
        if (currentSearchTerm === '') {
            // No search active, show all recipes
            this.displayRecipes();
        } else {
            // Search is active, refresh with current search term
            this.handleSearch(currentSearchTerm);
        }
    }

    scrollToPrepList() {
        const prepListSection = document.querySelector('.prep-list-section');
        if (prepListSection) {
            prepListSection.scrollIntoView({ 
                behavior: 'smooth',
                block: 'start'
            });
        }
    }

    scrollToSearch() {
        const searchSection = document.querySelector('.recipes-section');
        if (searchSection) {
            searchSection.scrollIntoView({ 
                behavior: 'smooth',
                block: 'start'
            });
            // Focus on the search input for better UX
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                setTimeout(() => searchInput.focus(), 500);
            }
        }
    }

    uncheckAllIngredients() {
        if (this.recipes.length === 0) {
            alert('No recipes available to uncheck ingredients!');
            return;
        }

        // Count total checked ingredients
        let totalCheckedIngredients = 0;
        this.recipes.forEach(recipe => {
            recipe.ingredients.forEach(ingredient => {
                if (ingredient.checked) {
                    totalCheckedIngredients++;
                }
            });
        });

        if (totalCheckedIngredients === 0) {
            alert('No ingredients are currently checked!');
            return;
        }

        if (confirm(`Uncheck all ${totalCheckedIngredients} checked ingredients across all recipes?`)) {
            // Uncheck all ingredients in all recipes
            this.recipes.forEach(recipe => {
                recipe.ingredients.forEach(ingredient => {
                    ingredient.checked = false;
                });
            });

            // Save changes and update displays
            this.saveRecipes();
            this.displayRecipes();
            this.displayPrepList();
            
            alert(`Successfully unchecked ${totalCheckedIngredients} ingredients!`);
        }
    }

    // Export recipes to JSON file
    exportRecipes() {
        if (this.recipes.length === 0) {
            alert('No recipes to export!');
            return;
        }

        const exportData = {
            recipes: this.recipes,
            exportDate: new Date().toISOString(),
            version: "1.0"
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `recipes-export-${new Date().toISOString().split('T')[0]}.json`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        alert(`Successfully exported ${this.recipes.length} recipes!`);
    }

    // Trigger file input for import
    triggerImport() {
        const fileInput = document.getElementById('import-file');
        fileInput.click();
    }

    // Import recipes from JSON file
    importRecipes(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (file.type !== 'application/json') {
            alert('Please select a valid JSON file!');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importData = JSON.parse(e.target.result);
                
                // Validate import data structure
                if (!importData.recipes || !Array.isArray(importData.recipes)) {
                    throw new Error('Invalid file format: missing recipes array');
                }

                // Validate each recipe structure
                const validRecipes = importData.recipes.filter(recipe => {
                    return recipe.id && recipe.name && recipe.ingredients && Array.isArray(recipe.ingredients);
                });

                if (validRecipes.length === 0) {
                    throw new Error('No valid recipes found in the file');
                }

                // Ask user if they want to replace or merge
                const shouldReplace = confirm(
                    `Found ${validRecipes.length} valid recipes in the file.\n\n` +
                    `Click OK to REPLACE all current recipes (${this.recipes.length} recipes will be lost).\n` +
                    `Click Cancel to MERGE with current recipes.`
                );

                if (shouldReplace) {
                    this.recipes = validRecipes;
                } else {
                    // Merge recipes, avoiding duplicates by name
                    const existingNames = new Set(this.recipes.map(r => r.name.toLowerCase()));
                    const newRecipes = validRecipes.filter(recipe => 
                        !existingNames.has(recipe.name.toLowerCase())
                    );
                    
                    // Assign new IDs to avoid conflicts
                    newRecipes.forEach(recipe => {
                        recipe.id = Date.now() + Math.random();
                    });
                    
                    this.recipes.push(...newRecipes);
                    
                    if (newRecipes.length < validRecipes.length) {
                        alert(`Imported ${newRecipes.length} new recipes. ${validRecipes.length - newRecipes.length} recipes were skipped (duplicates by name).`);
                    }
                }

                // Save and refresh display
                this.saveRecipes();
                this.displayRecipes();
                this.displayPrepList();
                
                if (shouldReplace) {
                    alert(`Successfully imported ${validRecipes.length} recipes!`);
                } else {
                    alert(`Successfully merged recipes! Total recipes: ${this.recipes.length}`);
                }

            } catch (error) {
                alert(`Error importing recipes: ${error.message}`);
            }
            
            // Reset file input
            event.target.value = '';
        };

        reader.readAsText(file);
    }

    // Prep List Name Management
    savePrepListName() {
        const nameInput = document.getElementById('prep-list-name');
        const name = nameInput.value.trim();
        
        if (name) {
            this.prepListName = name;
            
            // Save to current name
            this.storage.setItem('prepListName', name);
            
            // Add to saved names list
            let savedNames = this.getSavedPrepListNames();
            if (!savedNames.includes(name)) {
                savedNames.push(name);
                this.storage.setItem('savedPrepListNames', JSON.stringify(savedNames));
            }
            
            alert(`Prep list name saved as: "${name}"`);
        } else {
            alert('Please enter a name for the prep list');
        }
    }

    loadPrepListName() {
        return this.storage.getItem('prepListName') || '';
    }

    getSavedPrepListNames() {
        const saved = this.storage.getItem('savedPrepListNames');
        return saved ? JSON.parse(saved) : [];
    }

    showSavedPrepListNames() {
        // Get all guest names that have saved prep lists
        const allGuestNames = this.getAllGuestNames();
        
        if (allGuestNames.length === 0) {
            alert('No saved prep lists found.');
            return;
        }
        
        // Create a more interactive display
        this.displayGuestPrepListsModal(allGuestNames);
    }

    getAllGuestNames() {
        const guestNames = [];
        
        // Check localStorage for all guest prep lists
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (key && key.startsWith('guestPrepLists_')) {
                const guestName = key.replace('guestPrepLists_', '');
                const prepLists = this.getGuestPrepLists(guestName);
                if (prepLists.length > 0) {
                    guestNames.push(guestName);
                }
            }
        }
        
        return guestNames;
    }

    displayGuestPrepListsModal(guestNames) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;
        
        // Create modal content
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 10px;
            max-width: 500px;
            width: 90%;
            max-height: 80%;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;
        
        modal.innerHTML = `
            <h3 style="margin-top: 0; color: #333;">👥 Guest Prep Lists</h3>
            <div id="guest-prep-lists"></div>
            <div style="margin-top: 15px; text-align: right;">
                <button id="close-guest-modal" style="
                    background: #6c757d;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 5px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                " onmouseover="this.style.backgroundColor='#5a6268'" onmouseout="this.style.backgroundColor='#6c757d'">✖ Close</button>
            </div>
        `;
        
        // Add guest prep lists to the modal
        const guestListsContainer = modal.querySelector('#guest-prep-lists');
        
        guestNames.forEach(guestName => {
            const guestPrepLists = this.getGuestPrepLists(guestName);
            
            // Create guest section
            const guestSection = document.createElement('div');
            guestSection.style.cssText = `
                margin-bottom: 20px;
                border: 1px solid #dee2e6;
                border-radius: 8px;
                padding: 15px;
                background: #f8f9fa;
            `;
            
            const guestHeader = document.createElement('h4');
            guestHeader.style.cssText = `
                margin: 0 0 10px 0;
                color: #495057;
                font-size: 16px;
            `;
            guestHeader.textContent = `🍽️ ${guestName}`;
            guestSection.appendChild(guestHeader);
            
            // Add prep lists for this guest
            guestPrepLists.forEach((prepList, index) => {
                const prepListItem = document.createElement('div');
                prepListItem.style.cssText = `
                    padding: 8px 12px;
                    margin: 5px 0;
                    background: white;
                    border-radius: 5px;
                    cursor: pointer;
                    border: 1px solid #dee2e6;
                    transition: background-color 0.2s;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                `;
                
                const prepListInfo = document.createElement('div');
                const createdDate = new Date(prepList.createdAt).toLocaleDateString();
                const itemCount = prepList.items.length;
                
                // Use custom name if available, otherwise use default naming
                // Handle legacy data where name might be the guest name
                let displayName;
                if (prepList.name && prepList.name !== guestName) {
                    // Custom name exists and is different from guest name
                    displayName = prepList.name;
                } else {
                    // Legacy data or no custom name - use default format
                    displayName = `Prep List ${index + 1}`;
                }
                
                console.log('PrepList data:', prepList); // Debug log
                
                prepListInfo.innerHTML = `
                    <strong>${displayName}</strong><br>
                    <small style="color: #6c757d;">Created: ${createdDate} | Items: ${itemCount}</small>
                `;
                prepListInfo.style.cursor = 'pointer';
                prepListInfo.style.flex = '1';
                
                // Create action buttons container
                const actionsContainer = document.createElement('div');
                actionsContainer.style.cssText = `
                    display: flex;
                    gap: 5px;
                    align-items: center;
                `;
                
                // Edit button
                const editBtn = document.createElement('button');
                editBtn.innerHTML = '✏️';
                editBtn.title = 'Edit prep list name';
                editBtn.style.cssText = `
                    background: #007bff;
                    color: white;
                    border: none;
                    padding: 5px 8px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: background-color 0.2s;
                `;
                editBtn.addEventListener('mouseenter', () => editBtn.style.backgroundColor = '#0056b3');
                editBtn.addEventListener('mouseleave', () => editBtn.style.backgroundColor = '#007bff');
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.editGuestPrepListName(guestName, prepList.id, index + 1);
                });
                
                // Delete button
                const deleteBtn = document.createElement('button');
                deleteBtn.innerHTML = '🗑️';
                deleteBtn.title = 'Delete prep list';
                deleteBtn.style.cssText = `
                    background: #dc3545;
                    color: white;
                    border: none;
                    padding: 5px 8px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: background-color 0.2s;
                `;
                deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.backgroundColor = '#c82333');
                deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.backgroundColor = '#dc3545');
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteGuestPrepList(guestName, prepList.id, overlay);
                });
                
                actionsContainer.appendChild(editBtn);
                actionsContainer.appendChild(deleteBtn);
                
                prepListItem.appendChild(prepListInfo);
                prepListItem.appendChild(actionsContainer);
                
                prepListItem.addEventListener('mouseenter', () => {
                    prepListItem.style.backgroundColor = '#e9ecef';
                });
                
                prepListItem.addEventListener('mouseleave', () => {
                    prepListItem.style.backgroundColor = 'white';
                });
                
                prepListInfo.addEventListener('click', () => {
                    console.log('Loading prep list:', guestName, prepList.id);
                    console.log('Prep list data:', prepList);
                    
                    const success = this.loadGuestPrepList(guestName, prepList.id);
                    if (success) {
                        this.prepListName = guestName;
                        this.displayPrepListName();
                        document.body.removeChild(overlay);
                        alert(`Loaded prep list "${prepList.name || 'Prep List'}" for ${guestName}`);
                    } else {
                        alert('Failed to load prep list');
                    }
                });
                
                guestSection.appendChild(prepListItem);
            });
            
            guestListsContainer.appendChild(guestSection);
        });
        
        // Close modal functionality
        modal.querySelector('#close-guest-modal').addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    displaySavedNamesModal(savedNames) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;
        
        // Create modal content
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 10px;
            max-width: 400px;
            width: 90%;
            max-height: 80%;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;
        
        modal.innerHTML = `
            <h3 style="margin-top: 0; color: #333;">📋 Saved Prep List Names</h3>
            <div id="saved-names-list"></div>
            <div style="margin-top: 15px; text-align: right;">
                <button id="close-names-modal" style="
                    background: #6c757d;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 5px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                " onmouseover="this.style.backgroundColor='#5a6268'" onmouseout="this.style.backgroundColor='#6c757d'">✖ Close</button>
            </div>
        `;
        
        // Add names to the list
        const namesList = modal.querySelector('#saved-names-list');
        savedNames.forEach((name, index) => {
            const nameItem = document.createElement('div');
            nameItem.style.cssText = `
                padding: 10px;
                margin: 5px 0;
                background: #f8f9fa;
                border-radius: 5px;
                cursor: pointer;
                border: 1px solid #dee2e6;
                transition: background-color 0.2s;
            `;
            nameItem.textContent = `${index + 1}. ${name}`;
            
            nameItem.addEventListener('mouseenter', () => {
                nameItem.style.backgroundColor = '#e9ecef';
            });
            
            nameItem.addEventListener('mouseleave', () => {
                nameItem.style.backgroundColor = '#f8f9fa';
            });
            
            nameItem.addEventListener('click', () => {
                this.loadPrepListNameFromSaved(name);
                document.body.removeChild(overlay);
            });
            
            namesList.appendChild(nameItem);
        });
        
        // Close modal functionality
        modal.querySelector('#close-names-modal').addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    loadPrepListNameFromSaved(name) {
        this.prepListName = name;
        this.storage.setItem('prepListName', name);
        this.displayPrepListName();
        alert(`Loaded prep list name: "${name}"`);
    }

    updatePrepListHeading() {
        const headingElement = document.getElementById('prep-list-heading');
        
        if (headingElement) {
            headingElement.textContent = `📋 Prep List`;
        }
    }

    displayPrepListName() {
        const nameInput = document.getElementById('prep-list-name');
        
        if (nameInput && this.prepListName) {
            nameInput.value = this.prepListName;
        }
        
        // Update the heading when displaying the name
        this.updatePrepListHeading();
    }

    addNewName() {
        // Clear the current prep list
        this.prepList = [];
        this.displayPrepList();
        
        // Show the name input field
        const nameInput = document.getElementById('prep-list-name');
        nameInput.style.display = 'block';
        nameInput.focus();
        nameInput.value = '';
        nameInput.placeholder = 'Enter new prep list name...';
    }

    deleteGuestPrepList(guestName, prepListId, overlay) {
        if (confirm(`Are you sure you want to delete this prep list for ${guestName}?`)) {
            const guestPrepLists = this.getGuestPrepLists(guestName);
            const updatedPrepLists = guestPrepLists.filter(prepList => prepList.id !== prepListId);
            
            if (updatedPrepLists.length === 0) {
                // Remove the entire guest entry if no prep lists remain
                this.storage.removeItem(`guestPrepLists_${guestName}`);
            } else {
                // Update the guest's prep lists
                this.storage.setItem(`guestPrepLists_${guestName}`, JSON.stringify(updatedPrepLists));
            }
            
            // Close and reopen the modal to refresh the display
            document.body.removeChild(overlay);
            this.showSavedPrepListNames();
            alert('Prep list deleted successfully!');
        }
    }

    editGuestPrepListName(guestName, prepListId, prepListNumber) {
        const newName = prompt(`Enter new name for Prep List ${prepListNumber}:`, `${guestName} - Prep List ${prepListNumber}`);
        
        if (newName && newName.trim() !== '') {
            const guestPrepLists = this.getGuestPrepLists(guestName);
            const prepListIndex = guestPrepLists.findIndex(prepList => prepList.id === prepListId);
            
            if (prepListIndex !== -1) {
                guestPrepLists[prepListIndex].name = newName.trim();
                this.storage.setItem(`guestPrepLists_${guestName}`, JSON.stringify(guestPrepLists));
                
                // Refresh the modal display
                this.showSavedPrepListNames();
                alert('Prep list name updated successfully!');
            }
        }
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    const storage = new AppStorage();
    await storage.init();
    const app = new RecipeApp(storage);

    window.addEventListener('beforeunload', () => {
        storage.flush();
    });

    window.recipeApp = app;
});