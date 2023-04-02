import {FilterType, RecipeCompendium} from "./RecipeCompendium.js";
import {Crafting, getCurrencyComponent} from "../Crafting.js";
import {getDataFrom, sanitizeUuid} from "../helpers/Utility.js";
import {Settings} from "../Settings.js";
import {getToolConfig} from "./ToolConfig.js";
import {AnyOf} from "../AnyOf.js";
import {Recipe} from "../Recipe.js";
import {Result} from "../Result.js";
import {TestHandler} from "../TestHandler.js";

export class CraftingApp extends Application {
    data: {
        actor,
        filter,
        recipes:Recipe[],
        folders:{
            [key: string]: {
                folders: string[],
                recipes: Recipe[]
            }
        }
        filterItems:{},
        selected?,
        recipe?:Recipe,
        content?,
        result?:Result,
    };

    constructor(actor, options: any = {}) {
        super(options);
        this.data = {
            actor: actor,
            filter: FilterType.available,
            recipes: [],
            filterItems: {},
            folders: {},
        };
        if(this.element.length > 0){
            this.bringToTop();
        }
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            // @ts-ignore
            title: game.i18n.localize(`beaversCrafting.crafting-app.title`),
            width: 700,
            height: 450,
            template: "modules/beavers-crafting/templates/crafting-app.hbs",
            closeOnSubmit: true,
            submitOnClose: true,
            submitOnChange: true,
            resizable: true,
            classes: ["sheet", "beavers-crafting","crafting-app"],
            popOut: true,
            id: 'beavers-crafting'
        });
    }

    async getData(options = {}) {
        const data: any = mergeObject(this.data, await super.getData(options));
        let recipes = await RecipeCompendium.filterForActor(data.actor, data.filter);
        if(Object.values(data.filterItems).length != 0) {
            recipes = await RecipeCompendium.filterForItems(recipes, Object.values(data.filterItems));
        }
        recipes.sort(
            (a,b)=> {
                return recursiveSort(a, a.folder, b, b.folder)
        });

        function recursiveFolder(data,folder,recipe){
            if(folder === undefined || folder === ""){
                data[''] = data[''] || [];
                data[''].push(recipe);
            }else{
                const parts = folder.split(/\.(.*)/s);
                data[parts[0]] = data[parts[0]] || {folders:{}}
                recursiveFolder(data[parts[0]].folders,parts[1],recipe);
            }
        }

        recipes.forEach(recipe=>{
            recursiveFolder(data.folders,recipe.folder,recipe);
        });
        data.recipes = recipes;
        if(!data.selected){
            data.selected = data.recipes[0]?.uuid;
        }
        this.selectRecipe(data.selected);
        data.content = null;
        return data;
    }

    selectRecipe(uuid: string){
        this.data.selected = uuid;
        this.data.recipes.forEach(r=>{
            if(r.uuid === uuid){
                this.data.recipe = Recipe.clone(r);
                return;
            }
        });
    }

    async renderRecipeSheet() {
        if (this.data.recipe === undefined || this.element === null) {
            return;
        }
        const crafting = await Crafting.from(this.data.actor.id, this.data.recipe.uuid);
        RecipeCompendium.validateRecipeToItemList(Object.values(this.data.recipe.ingredients), this.data.actor.items,crafting.result);
        await crafting.checkTool();
        await crafting.checkAttendants();
        await crafting.checkCurrency();
        this.data.result = crafting.result;
        this.data.content = await renderTemplate('modules/beavers-crafting/templates/crafting-app-main.hbs',
            {
                recipe: this.data.recipe,
                currencyComponent: this.data.recipe.currency?getCurrencyComponent(this.data.recipe.currency.name,this.data.recipe.currency.value):undefined,
                skills: beaversSystemInterface.configSkills,
                abilities: beaversSystemInterface.configCanRollAbility?beaversSystemInterface.configAbilities:[],
                tools: await getToolConfig(),
                precast: await this.getPrecastFromResult(this.data.result,this.data.recipe),
                maxHits: this.data.recipe.tests?TestHandler.getMaxHits(this.data.recipe.tests):0,
                displayResults:Settings.get(Settings.DISPLAY_RESULTS),
                displayIngredients:Settings.get(Settings.DISPLAY_RESULTS),
                useTool: Settings.get(Settings.USE_TOOL),
                useAttendants: Settings.get(Settings.USE_ATTENDANTS)
            });
        this.element.find(".sheet-body").empty();
        this.element.find(".sheet-body").append(this.data.content);
        this.activateRecipeSheetListener(this.element);
    }

    activateListeners(html) {

        super.activateListeners(html);
        html.find(".sidebar select.search").on("change", (e) => {
            this.data.filter = $(e.target).val();
            this.data.selected = null;
            this.data.content = null;
            this.data.folders = {};
            this.render();
        });
        html.find(".sidebar .navigation .recipeItem").on("click", (e) => {
            const id = $(e.currentTarget).data().id;
            this.selectRecipe(id);
            html.find(".sidebar .navigation .selected").removeClass("selected");
            html.find(".sidebar .navigation .recipeItem[data-id='" + id + "']").addClass("selected");
            void this.renderRecipeSheet();
        });

        html.find(".folderName").on("click", (e)=>{
            $(e.currentTarget).parent(".folder").toggleClass(["open","close"]);
        });
        html.find(".sidebar .fa-sort-amount-up").on("click", (e)=>{
            html.find(".navigation .folder").removeClass("open").addClass("close");
        });
        void this.renderRecipeSheet();
    }

    activateRecipeSheetListener(html) {
        html.find('.results .clickable').on("click",e=>{
            const uuid = $(e.currentTarget).data("id");
            if(Settings.get(Settings.DISPLAY_RESULTS)) {
                beaversSystemInterface.uuidToDocument(uuid).then(i=>i.sheet._render(true));
            }
        });
        html.find('.ingredients .clickable').on("click",e=>{
            const uuid = $(e.currentTarget).data("id");
            if(Settings.get(Settings.DISPLAY_INGREDIENTS)) {
                beaversSystemInterface.uuidToDocument(uuid).then(i=>i.sheet._render(true));
            }
        });
        html.find(".main .folderName").on("click", (e)=>{
            $(e.currentTarget).parent(".folder").toggleClass(["open","close"]);
        });
        html.find(".dialog-button").on("click", (e) => {
            if (this.data.recipe === undefined){
                return;
            }
            Crafting.fromRecipe(this.data.actor.id, this.data.recipe)
                .then(crafting => {
                    return crafting.craft();
                }).then(result => {
                this.close();
            });
        });
        this.addDragDrop(html);
    }

    addDragDrop(html) {
        const dropFilter = new DragDrop({
            dropSelector: '.drop-area, .ingredients .flexrow',
            permissions: {
                dragstart: this._canDragStart.bind(this),
                drop: this._canDragDrop.bind(this)
            },
            callbacks: {
                dragstart: this._onDragStart.bind(this),
                dragover: this._onDragOver.bind(this),
                drop: this._onDrop.bind(this)
            }
        });
        if(this._dragDrop.length > 1){
            this._dragDrop.pop();
        }
        this._dragDrop.push(dropFilter);
        dropFilter.bind(html[0]);
    }

    async _onDrop(e){
        const isFilterDrop = $(e.target).hasClass("drop-area");
        if(isFilterDrop){
            return this._onDropFilter(e);
        }
        const uuid = $(e.currentTarget).data("id");
        if(uuid != undefined){
            const uuid = $(e.currentTarget).data("id");
            const key = $(e.currentTarget).data("key");
            beaversSystemInterface.uuidToDocument(uuid).then(
                item => {
                    if(AnyOf.isAnyOf(item)){
                       return this._onDropAnyOf(new AnyOf(item),key,e);
                    }
                    return;
                }
            )
        }

    }

    async _onDropAnyOf(anyOf:AnyOf, key:string, e:DragEvent) {
        if (this.data.recipe === undefined){
            return;
        }
        const data = getDataFrom(e);
        if(data) {
            if (data.type !== "Item") return;
            const entity = await fromUuid(data.uuid);
            let result = await anyOf.executeMacro(entity);
            if(result.value) {
                const previousComponent = this.data.recipe.ingredients[key];
                const component = beaversSystemInterface.componentFromEntity(entity);
                const nextKey = sanitizeUuid(data.uuid);
                component.quantity = previousComponent.quantity;
                this.data.recipe = Recipe.clone(this.data.recipe);
                //remove existing ingredient with same id and add quantity;
                if(this.data.recipe.ingredients[nextKey]){
                    component.quantity = component.quantity + this.data.recipe.ingredients[nextKey].quantity;
                    delete this.data.recipe.ingredients[nextKey];
                }
                //copyInPlace;
                const ingredients = Object.fromEntries(
                    Object.entries(this.data.recipe.ingredients).map(([o_key, o_val]) => {
                        if (o_key === key) return [nextKey, component];
                        return [o_key, o_val];
                    })
                );
                this.data.recipe.ingredients = ingredients;
                void this.renderRecipeSheet();
            }

        }
    }

    async _onDropFilter(e:DragEvent){
        const data = getDataFrom(e)
        if(data){
            if(data.type !== "Item") return;
            let entity = await fromUuid(data.uuid);
            this.data.filterItems[data.uuid] = entity;

            this.render();
        }
    }

    async getPrecastFromResult(result: Result, recipe: Recipe): Promise<PreCastData>{
        const preCastData:PreCastData = {
            attendants: {},
            ingredients: {},
            tool: false,
        }
        if(result._currencyResult){
            preCastData.currencies = {isAvailable: !result._currencyResult.hasError};
        }

        for(const key in recipe.ingredients){
            const component = recipe.ingredients[key];
            preCastData.ingredients[key]={
                isAvailable: !result._components.consumed.hasError(component)
            }
        }
        for(const key in recipe.attendants){
            const component = recipe.attendants[key];
            preCastData.attendants[key]={
                isAvailable: !result._components.required.hasError(component)
            }
        }
        if(Settings.get(Settings.USE_TOOL) && recipe.tool){
            const item = await beaversSystemInterface.uuidToDocument(recipe.tool);
            const component = beaversSystemInterface.componentFromEntity(item);
            preCastData.tool = !result._components.required.hasError(component)
        }
        return preCastData;
    }
}


function recursiveSort(a, afolder:string|undefined,b, bfolder:string|undefined){
    if(afolder === undefined || afolder === ""){
        if(bfolder !== undefined && bfolder !== ""){
            return 1
        }else{
            if(a.name < b.name){
                return -1
            }
            if(a.name > b.name){
                return 1;
            }
            return 0
        }
    }else{
        if(bfolder === undefined || bfolder === ""){
            return -1
        }else{
            const aparts = afolder.split(/\.(.*)/s);
            const bparts = bfolder.split(/\.(.*)/s);
            if(aparts[0] < bparts[0]){
                return -1
            }else if(aparts[0] > bparts[0]){
                return 1;
            }else {
                return recursiveSort(a, aparts[1],b, bparts[1])
            }
        }
    }
}