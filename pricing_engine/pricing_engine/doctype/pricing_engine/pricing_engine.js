frappe.ui.form.on('Pricing Engine', {
    refresh: function(frm) {
        // Dynamic button label change
        if (frm.doc.pricing_plan === 'Manufactured') {
            frm.set_df_property('update_chinese_prices', 'label', 'Update USD Price');
        } else {
            frm.set_df_property('update_chinese_prices', 'label', 'Update Chinese Prices');
        }
    },

    pricing_plan: function(frm) {
        // Sync plan to all child rows
        if (frm.doc.items) {
            frm.doc.items.forEach(row => {
                frappe.model.set_value('Pricing Engine Item', row.name, 'pricing_plan', frm.doc.pricing_plan);
            });
            frm.refresh_field('items');
        }
    },

    material_item_code: function(frm) {
        if (frm.doc.material_item_code) {
            frappe.call({
                method: 'pricing_engine.pricing_engine.api.material_price_api.get_material_price',
                args: { item_code: frm.doc.material_item_code },
                callback: function(r) {
                    if (r.message) {
                        frm.set_value('material_price_usd', r.message);
                        calculate_parent_manufacturing(frm);
                    }
                }
            });
        }
    },

    pieces_from_rod: function(frm) { calculate_parent_manufacturing(frm); },
    factory_markup_percent: function(frm) { calculate_parent_manufacturing(frm); },

    fetch_items: function(frm) {
        open_filter_dialog(frm);
    },

    apply_defaults: function(frm) {
        apply_defaults_to_all_rows(frm);
    },

    update_chinese_prices: function(frm) {
        update_prices_from_initial(frm);
    },

    apply_to_item_prices: function(frm) {
        if (frm.is_new()) {
            frappe.msgprint(__('Please save the document first before applying prices.'));
            frm.save();
            return;
        }
        apply_to_item_prices(frm);
    },

    default_cny_usd_rate: function(frm) {},
    default_shipping_factor: function(frm) {},
    default_wholesale_usd_markup: function(frm) {},
    default_usd_egp_rate: function(frm) {},
    default_retail_egp_markup: function(frm) {}
});

function calculate_parent_manufacturing(frm) {
    let material_price = flt(frm.doc.material_price_usd);
    let pieces = flt(frm.doc.pieces_from_rod);
    let markup = flt(frm.doc.factory_markup_percent);

    if (pieces > 0) {
        let piece_price = roundNumber(material_price / pieces, 2);
        frm.set_value('piece_price_usd', piece_price);

        let factory_price = roundNumber(piece_price * (1 + markup / 100), 2);
        frm.set_value('factory_price_usd', factory_price);
    }
}

// ============================================
// CHILD TABLE CALCULATIONS
// ============================================

frappe.ui.form.on('Pricing Engine Item', {
    cny_usd_rate: function(frm, cdt, cdn) { calculate_row(frm, cdt, cdn); },
    shipping_factor: function(frm, cdt, cdn) { calculate_row(frm, cdt, cdn); },
    wholesale_usd_markup: function(frm, cdt, cdn) { calculate_row(frm, cdt, cdn); },
    usd_egp_rate: function(frm, cdt, cdn) { calculate_row(frm, cdt, cdn); },
    retail_egp_markup: function(frm, cdt, cdn) { calculate_row(frm, cdt, cdn); },
    chinese_price: function(frm, cdt, cdn) { calculate_row(frm, cdt, cdn); },
    factory_markup_percent: function(frm, cdt, cdn) { calculate_row(frm, cdt, cdn); },
    factory_price_usd: function(frm, cdt, cdn) { calculate_row(frm, cdt, cdn); }
});

function calculate_row(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let plan = row.pricing_plan || frm.doc.pricing_plan;

    let wholesale_usd = 0;

    if (plan === 'Imported') {
        let chinese_price = flt(row.chinese_price);
        let cny_usd_rate = flt(row.cny_usd_rate);
        let shipping_factor = flt(row.shipping_factor);
        let wholesale_usd_markup = flt(row.wholesale_usd_markup);

        if (cny_usd_rate !== 0) {
            let conv = roundNumber(chinese_price / cny_usd_rate, 2);
            let ship = roundNumber(conv * (1 + shipping_factor / 100), 2);
            wholesale_usd = roundNumber(ship * (1 + wholesale_usd_markup / 100), 2);
            
            frappe.model.set_value(cdt, cdn, 'price_after_conversion_usd', conv);
            frappe.model.set_value(cdt, cdn, 'price_after_shipping_usd', ship);
        }
    } else if (plan === 'Manufactured') {
        let base_factory_price = flt(frm.doc.factory_price_usd);
        let row_markup = flt(row.factory_markup_percent);
        let piece_price = flt(frm.doc.piece_price_usd);

        if (row_markup !== 0) {
            wholesale_usd = roundNumber(piece_price * (1 + row_markup / 100), 2);
        } else {
            wholesale_usd = roundNumber(base_factory_price, 2);
        }
        frappe.model.set_value(cdt, cdn, 'factory_price_usd', wholesale_usd);
    }

    let usd_egp_rate = flt(row.usd_egp_rate);
    let retail_egp_markup = flt(row.retail_egp_markup);

    if (usd_egp_rate !== 0) {
        let raw_wholesale_egp = wholesale_usd * usd_egp_rate;
        let wholesale_egp = Math.ceil(raw_wholesale_egp / 5) * 5;
        
        let raw_retail_egp = wholesale_egp * (1 + retail_egp_markup / 100);
        let retail_egp = Math.round(raw_retail_egp / 5) * 5;

        frappe.model.set_value(cdt, cdn, 'wholesale_usd_price', wholesale_usd);
        frappe.model.set_value(cdt, cdn, 'wholesale_egp_price', wholesale_egp);
        frappe.model.set_value(cdt, cdn, 'retail_egp_price', retail_egp);
    }
}

function roundNumber(num, decimals) {
    return Math.round((num + Number.EPSILON) * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function apply_defaults_to_all_rows(frm) {
    if (!frm.doc.items || frm.doc.items.length === 0) {
        frappe.msgprint(__('No items in the table. Fetch items first.'));
        return;
    }

    let defaults = {
        cny_usd_rate: flt(frm.doc.default_cny_usd_rate),
        shipping_factor: flt(frm.doc.default_shipping_factor),
        wholesale_usd_markup: flt(frm.doc.default_wholesale_usd_markup),
        usd_egp_rate: flt(frm.doc.default_usd_egp_rate || frm.doc.manu_default_usd_egp_rate),
        retail_egp_markup: flt(frm.doc.default_retail_egp_markup || frm.doc.manu_default_retail_egp_markup)
    };

    frm.doc.items.forEach(row => {
        if (frm.doc.pricing_plan === 'Imported') {
            frappe.model.set_value('Pricing Engine Item', row.name, 'cny_usd_rate', defaults.cny_usd_rate || row.cny_usd_rate);
            frappe.model.set_value('Pricing Engine Item', row.name, 'shipping_factor', defaults.shipping_factor || row.shipping_factor);
            frappe.model.set_value('Pricing Engine Item', row.name, 'wholesale_usd_markup', defaults.wholesale_usd_markup || row.wholesale_usd_markup);
        } else {
            frappe.model.set_value('Pricing Engine Item', row.name, 'factory_markup_percent', frm.doc.factory_markup_percent || row.factory_markup_percent);
            frappe.model.set_value('Pricing Engine Item', row.name, 'factory_price_usd', frm.doc.factory_price_usd || row.factory_price_usd);
        }
        frappe.model.set_value('Pricing Engine Item', row.name, 'usd_egp_rate', defaults.usd_egp_rate || row.usd_egp_rate);
        frappe.model.set_value('Pricing Engine Item', row.name, 'retail_egp_markup', defaults.retail_egp_markup || row.retail_egp_markup);
    });

    frappe.show_alert({
        message: __('Defaults applied to {0} rows', [frm.doc.items.length]),
        indicator: 'green'
    });
}

function update_prices_from_initial(frm) {
    if (!frm.doc.items || frm.doc.items.length === 0) {
        frappe.msgprint(__('No items to update.'));
        return;
    }

    let plan = frm.doc.pricing_plan || 'Imported';

    if (plan === 'Manufactured') {
        if (!frm.doc.material_item_code) {
            frappe.msgprint(__('Please select a Material Item first.'));
            return;
        }

        frappe.dom.freeze(__('Updating material price...'));
        frappe.call({
            method: 'pricing_engine.pricing_engine.api.material_price_api.get_material_price',
            args: { item_code: frm.doc.material_item_code },
            callback: function(r) {
                frappe.dom.unfreeze();
                if (r.message) {
                    frm.set_value('material_price_usd', r.message);
                    calculate_parent_manufacturing(frm);

                    // Propagate to all child rows
                    let factory_price = flt(frm.doc.factory_price_usd);
                    frm.doc.items.forEach(row => {
                        frappe.model.set_value('Pricing Engine Item', row.name, 'factory_price_usd', factory_price);
                    });
                    
                    frappe.show_alert({
                        message: __('Material price updated and propagated to all items.'),
                        indicator: 'green'
                    });
                } else {
                    frappe.msgprint(__('No material price found for the selected item.'));
                }
            },
            error: function(err) {
                frappe.dom.unfreeze();
                frappe.msgprint(__('Failed to update material price.'));
            }
        });
        return;
    }

    // IMPORTED PLAN LOGIC
    let itemCodes = frm.doc.items.map(row => row.item_code).filter(Boolean);
    frappe.dom.freeze(__('Updating prices...'));

    frappe.call({
        method: 'pricing_engine.pricing_engine.api.pricing_engine_api.get_latest_initial_prices',
        args: { 
            item_codes: JSON.stringify(itemCodes),
            pricing_plan: plan 
        },
        callback: function(r) {
            frappe.dom.unfreeze();

            if (r.exc) {
                frappe.msgprint(__('Error updating prices.'));
                return;
            }

            let prices = r.message || {};

            frm.doc.items.forEach(row => {
                let price = prices[row.item_code];
                if (price !== undefined) {
                    frappe.model.set_value('Pricing Engine Item', row.name, 'chinese_price', price);
                }
            });

            frappe.show_alert({
                message: __('Chinese prices updated for {0} items', [Object.keys(prices).length]),
                indicator: 'green'
            });
        },
        error: function(err) {
            frappe.dom.unfreeze();
            frappe.msgprint(__('Failed to update prices.'));
        }
    });
}

function open_filter_dialog(frm) {
    let dialog = new frappe.ui.Dialog({
        title: __('Filter Items'),
        fields: [
            {
                fieldtype: 'HTML',
                fieldname: 'filter_builder',
                options: get_filter_html()
            }
        ],
        size: 'large',
        primary_action_label: __('Fetch & Add'),
        primary_action: function() {
            let filters = collect_filters(dialog);
            if (filters.length === 0) {
                frappe.msgprint(__('Please add at least one filter.'));
                return;
            }
            fetch_items_with_filters(frm, filters);
            dialog.hide();
        },
        secondary_action_label: __('Clear'),
        secondary_action: function() {
            clear_filter_rows(dialog);
        }
    });

    dialog.show();
    init_filter_events(dialog);
}

function get_filter_html() {
    return `
        <div class="pricing-filter-builder" style="border: 1px solid #d1d8dd; border-radius: 6px; padding: 16px; background: #ffffff;">
            <div class="filter-rows-container" style="margin-bottom: 12px;"></div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button class="btn btn-xs btn-default btn-add-filter" style="color: #5e64ff; border-color: #5e64ff;">
                    <i class="fa fa-plus"></i> Add Filter
                </button>
                <span class="filter-count" style="margin-left: auto; font-size: 12px; color: #8d99a6;"></span>
            </div>
        </div>
    `;
}

function init_filter_events(dialog) {
    let wrapper = dialog.fields_dict.filter_builder.$wrapper;
    add_filter_row(wrapper, {}, 0);
    wrapper.find('.btn-add-filter').on('click', function() {
        let count = wrapper.find('.filter-row').length;
        add_filter_row(wrapper, {}, count);
    });
}

function add_filter_row(wrapper, filter = {}, index) {
    let container = wrapper.find('.filter-rows-container');
    let fieldOptions = [
        { value: 'item_group', label: 'Item Group', type: 'link' },
        { value: 'brand', label: 'Brand', type: 'link' },
        { value: 'item_name', label: 'Item Name', type: 'data' },
        { value: 'stock_uom', label: 'Stock UOM', type: 'link' },
        { value: 'is_stock_item', label: 'Is Stock Item', type: 'check' },
        { value: 'is_sales_item', label: 'Is Sales Item', type: 'check' },
        { value: 'is_purchase_item', label: 'Is Purchase Item', type: 'check' },
        { value: 'standard_rate', label: 'Standard Rate', type: 'currency' },
        { value: 'valuation_rate', label: 'Valuation Rate', type: 'currency' },
        { value: 'description', label: 'Description', type: 'text' },
        { value: 'disabled', label: 'Disabled', type: 'check' },
        { value: 'name', label: 'Item Code', type: 'data' }
    ];
    let conditionOptions = [
        { value: '=', label: 'Equals' },
        { value: '!=', label: 'Not Equals' },
        { value: 'like', label: 'Like' },
        { value: 'not like', label: 'Not Like' },
        { value: 'in', label: 'In' },
        { value: 'not in', label: 'Not In' },
        { value: 'is', label: 'Is' },
        { value: '>', label: 'Greater Than' },
        { value: '<', label: 'Less Than' },
        { value: '>=', label: 'Greater Than or Equal' },
        { value: '<=', label: 'Less Than or Equal' }
    ];
    let fieldHtml = fieldOptions.map(opt =>
        `<option value="${opt.value}" ${filter.field === opt.value ? 'selected' : ''} data-type="${opt.type}">${opt.label}</option>`
    ).join('');
    let conditionHtml = conditionOptions.map(opt =>
        `<option value="${opt.value}" ${filter.condition === opt.value ? 'selected' : ''}>${opt.label}</option>`
    ).join('');
    let row = `
        <div class="filter-row" data-index="${index}" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 8px; background: #f8f9fa; border-radius: 4px; border: 1px solid #e2e8f0;">
            <select class="form-control filter-field" style="width: 160px; height: 32px; font-size: 13px;">
                <option value="">Select Field...</option>
                ${fieldHtml}
            </select>
            <select class="form-control filter-condition" style="width: 140px; height: 32px; font-size: 13px;">
                <option value="">Condition...</option>
                ${conditionHtml}
            </select>
            <input type="text" class="form-control filter-value" placeholder="Enter value..." value="${filter.value || ''}" style="width: 200px; height: 32px; font-size: 13px;">
            <button class="btn btn-xs btn-default btn-remove-filter" style="color: #ff5858; border: none; background: transparent; padding: 4px 8px;">
                <i class="fa fa-times"></i>
            </button>
        </div>
    `;
    container.append(row);
    container.find(`.filter-row[data-index="${index}"] .btn-remove-filter`).on('click', function() {
        $(this).closest('.filter-row').remove();
        reindex_filter_rows(container);
    });
}

function reindex_filter_rows(container) {
    container.find('.filter-row').each(function(i) {
        $(this).attr('data-index', i);
    });
}

function clear_filter_rows(dialog) {
    let wrapper = dialog.fields_dict.filter_builder.$wrapper;
    wrapper.find('.filter-rows-container').empty();
    add_filter_row(wrapper, {}, 0);
}

function collect_filters(dialog) {
    let wrapper = dialog.fields_dict.filter_builder.$wrapper;
    let filters = [];
    wrapper.find('.filter-row').each(function() {
        let field = $(this).find('.filter-field').val();
        let condition = $(this).find('.filter-condition').val();
        let value = $(this).find('.filter-value').val();
        if (field && condition && (value !== '' || condition === 'is')) {
            filters.push({ field, condition, value });
        }
    });
    return filters;
}

function fetch_items_with_filters(frm, filters) {
    frappe.dom.freeze(__('Fetching items...'));
    frappe.call({
        method: 'pricing_engine.pricing_engine.api.pricing_engine_api.get_filtered_items',
        args: { filters: JSON.stringify(filters) },
        callback: function(r) {
            frappe.dom.unfreeze();
            if (r.exc) {
                frappe.msgprint(__('Error fetching items.'));
                return;
            }
            let items = r.message || [];
            if (items.length === 0) {
                frappe.show_alert({ message: __('No items match the filters.'), indicator: 'orange' });
                return;
            }
            let existingCodes = new Set();
            (frm.doc.items || []).forEach(row => {
                if (row.item_code) existingCodes.add(row.item_code);
            });
            let added = 0, skipped = 0;
            items.forEach(item => {
                if (existingCodes.has(item.name)) {
                    skipped++;
                    return;
                }

                let row = frm.add_child('items');
                row.item_code = item.name;
                row.item_name = item.item_name;
                row.pricing_plan = frm.doc.pricing_plan;
                added++;
            });
            
            // Remove the default empty row if it exists
            if (frm.doc.items.length > added && (!frm.doc.items[0].item_code || frm.doc.items[0].item_code === "")) {
                frm.doc.items.shift();
            }

            frm.refresh_field('items');
            frappe.show_alert({
                message: __('{0} items added{1}', [added, skipped > 0 ? ` (${skipped} duplicates skipped)` : '']),
                indicator: 'green'
            });
        },
        error: function(err) {
            frappe.dom.unfreeze();
            frappe.msgprint(__('Failed to fetch items.'));
        }
    });
}

function apply_to_item_prices(frm) {
    if (!frm.doc.items || frm.doc.items.length === 0) {
        frappe.msgprint(__('No items to apply.'));
        return;
    }
    let pls = {
        wholesale_usd: frm.doc.wholesale_usd_price_list,
        wholesale_egp: frm.doc.wholesale_egp_price_list,
        retail_egp: frm.doc.retail_egp_price_list
    };
    let populated = Object.entries(pls).filter(([k, v]) => v);
    if (populated.length === 0) {
        frappe.msgprint({
            title: __('No Price Lists Selected'),
            message: __('Please select at least one Price List before applying.'),
            indicator: 'red'
        });
        return;
    }
    let empty = Object.entries(pls).filter(([k, v]) => !v);
    let confirmMessage = '';
    if (empty.length > 0) {
        let emptyNames = empty.map(([k]) => {
            if (k === 'wholesale_usd') return 'Wholesale USD';
            if (k === 'wholesale_egp') return 'Wholesale EGP';
            return 'Retail EGP';
        }).join(', ');
        let populatedNames = populated.map(([k]) => {
            if (k === 'wholesale_usd') return 'Wholesale USD';
            if (k === 'wholesale_egp') return 'Wholesale EGP';
            return 'Retail EGP';
        }).join(', ');
        confirmMessage = __('The following Price Lists are empty: <b>{0}</b><br><br>Prices will be applied ONLY to:<br><b>{1}</b><br><br>Continue?', [emptyNames, populatedNames]);
    } else {
        confirmMessage = __('Apply prices to all 3 Price Lists?<br><br><b>Wholesale USD</b>: {0}<br><b>Wholesale EGP</b>: {1}<br><b>Retail EGP</b>: {2}',
            [pls.wholesale_usd, pls.wholesale_egp, pls.retail_egp]);
    }
    frappe.confirm(confirmMessage, function() {
        frappe.dom.freeze(__('Applying prices...'));
        frappe.call({
            method: 'pricing_engine.pricing_engine.api.pricing_engine_api.apply_to_item_prices',
            args: { docname: frm.doc.name },
            callback: function(r) {
                frappe.dom.unfreeze();
                if (r.exc) {
                    frappe.msgprint(__('Error applying prices.'));
                    return;
                }
                let result = r.message || {};
                let msg = [];
                if (result.wholesale_usd) msg.push(__('Wholesale USD: {0} created, {1} updated', [result.wholesale_usd.created, result.wholesale_usd.updated]));
                if (result.wholesale_egp) msg.push(__('Wholesale EGP: {0} created, {1} updated', [result.wholesale_egp.created, result.wholesale_egp.updated]));
                if (result.retail_egp) msg.push(__('Retail EGP: {0} created, {1} updated', [result.retail_egp.created, result.retail_egp.updated]));
                frappe.show_alert({
                    message: msg.join('<br>'),
                    indicator: 'green'
                });
                frm.reload_doc();
            },
            error: function(err) {
                frappe.dom.unfreeze();
                frappe.msgprint(__('Failed to apply prices.'));
            }
        });
    });
}
