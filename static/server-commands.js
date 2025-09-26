/*
  Server Commands Extension (using <htmx> tags)
  ======================================================
  This extension enables server-driven UI updates using custom <htmx> elements
  in a server response. It allows a single response to contain multiple
  commands for swapping content, triggering events, and managing browser history.
*/
(function () {
    /** @type {import("../htmx").HtmxInternalApi} */
    let api;

    // <htmx> tag valid attributes
    const VALID_COMMAND_ATTRIBUTES = new Set([
        'target',
        'swap',
        'select',
        'redirect',
        'refresh',
        'location',
        'push-url',
        'replace-url',
        'trigger',
        'trigger-after-swap',
        'trigger-after-settle',
    ]);

    htmx.defineExtension('server-commands', {
        /** @param {import("../htmx").HtmxInternalApi} apiRef */
        init: function (apiRef) {
            api = apiRef;
        },

        /** @param {string} text, @param {XMLHttpRequest} xhr, @param {Element} elt */
        transformResponse: function (text, xhr, elt) {
            // Check if empty text, or no <htmx> tags
            const fragment = text ? api.makeFragment(text) : null;
            if (!fragment || !fragment.querySelector('htmx')) {
                return text; // Return early
            }

            // Find all <htmx> tags
            const allCommandElements = fragment.querySelectorAll('htmx');

            // Keep only top-level ones (direct children of the fragment)
            const topLevelCommandElements = Array.from(allCommandElements).filter(el => {
                // Check if this htmx element is a direct child of the fragment
                return el.parentNode === fragment;
            });

            if (allCommandElements.length > topLevelCommandElements.length) {
                console.warn(
                    '[server-commands] Nested <htmx> command tags are not supported and will be discarded.',
                    { triggeringElement: elt }
                );
            }

            // Process ONLY the top-level <htmx> tags in order
            (async () => {
                for (const el of topLevelCommandElements) {
                    await processCommandFromElement(el, elt);
                }
            })();

            // Remove all <htmx> tags from the fragment
            allCommandElements.forEach(el => el.remove());

            // Serialize remaining nodes into an HTML string
            const container = document.createElement('div');
            container.appendChild(fragment);

            return container.innerHTML;
        },
    });

    /**
     * Processes a single <htmx> element by reading its attributes and executing
     * actions in a fixed, sequential order.
     * @param {HTMLElement} commandElt
     * @param {Element} contextElt
     */
    async function processCommandFromElement(commandElt, contextElt) {
        try {
            // Fire a cancelable event for this specific tag.
            if (api.triggerEvent(contextElt, 'htmx:beforeServerCommand', {
                commandElement: commandElt,
                context: contextElt
            }) === false) {
                return; // Stop processing
            }

            // --- VALIDATION ---
            validateCommandElement(commandElt);

            // --- STEP 1: GATHER SWAP JOBS ---
            const swapJobs = [];
            const commandSwapStyle = api.getAttributeValue(commandElt, 'swap') || 'outerHTML';
            const commandSelect = api.getAttributeValue(commandElt, 'select');
            const commandTargetSelector = api.getAttributeValue(commandElt, 'target');

            if (commandTargetSelector) {
                // Explicit target (e.g. <htmx target="#explicit">...</htmx>)
                const commandTargetEl = htmx.find(commandTargetSelector);
                if (commandTargetEl) {
                    swapJobs.push({ targetEl: commandTargetEl, content: commandElt.innerHTML });
                } else {
                    const error = new Error(`[server-commands] The target selector "${commandTargetSelector}" did not match any elements.`);
                    api.triggerErrorEvent(contextElt, 'htmx:targetError', { error: error, target: commandTargetSelector });
                }
            }
            // Note: validateCommandElement() already checks for missing target attribute

            // --- STEP 2: IMMEDIATE TRIGGERS & COMMANDS (execute synchronously) ---
            if (commandElt.hasAttribute('trigger')) {
                handleTriggerAttribute({value: commandElt.getAttribute('trigger')});
            }
            if (commandElt.hasAttribute('location')) {
                handleLocationAttribute(commandElt.getAttribute('location'), contextElt);
            }
            if (commandElt.hasAttribute('redirect')) {
                window.location.href = commandElt.getAttribute('redirect');
                return; // Stop processing
            }
            if (commandElt.hasAttribute('refresh') && commandElt.getAttribute('refresh') !== 'false') {
                window.location.reload();
                return; // Stop processing
            }
            if (commandElt.hasAttribute('push-url')) {
                api.saveCurrentPageToHistory();
                api.pushUrlIntoHistory(commandElt.getAttribute('push-url'));
            }
            if (commandElt.hasAttribute('replace-url')) {
                api.saveCurrentPageToHistory();
                api.replaceUrlInHistory(commandElt.getAttribute('replace-url'));
            }

            // --- STEP 3: PROCESS SWAP JOBS WITH TIMED TRIGGERS ---
            if (swapJobs.length > 0) {
                const swapSpec = api.getSwapSpecification(contextElt, commandSwapStyle);

                for (const job of swapJobs) {
                    const beforeSwapDetails = {
                        elt: contextElt,
                        target: job.targetEl,
                        swapSpec: swapSpec,
                        serverResponse: job.content,
                        shouldSwap: true,
                        fromServerCommand: true
                    };

                    if (api.triggerEvent(job.targetEl, 'htmx:beforeSwap', beforeSwapDetails) === false) {
                        continue; // Skip this job if a listener cancelled it
                    }

                    if (beforeSwapDetails.shouldSwap) {
                        // Use htmx's built-in swap with callbacks for trigger coordination
                        api.swap(
                            beforeSwapDetails.target,
                            beforeSwapDetails.serverResponse,
                            beforeSwapDetails.swapSpec,
                            {
                                select: commandSelect,
                                eventInfo: { elt: contextElt },
                                contextElement: contextElt,
                                afterSwapCallback: commandElt.hasAttribute('trigger-after-swap')
                                    ? () => handleTriggerAttribute({value: commandElt.getAttribute('trigger-after-swap')})
                                    : undefined,
                                afterSettleCallback: commandElt.hasAttribute('trigger-after-settle')
                                    ? () => handleTriggerAttribute({value: commandElt.getAttribute('trigger-after-settle')})
                                    : undefined
                            }
                        );
                    }
                }
            }

            api.triggerEvent(contextElt, 'htmx:afterServerCommand', {commandElement: commandElt});

        } catch (error) {
            // Fire the public event for programmatic listeners.
            api.triggerErrorEvent(
                document.body, 'htmx:serverCommandError', {error: error, commandElement: commandElt}
            );
        }
    }

    /**
     * Validate <htmx> element & throw an error for unknown attributes or invalid combinations.
     * @param {HTMLElement} element
     */
    function validateCommandElement(element) {
        const errors = [];

        const hasCommandAttribute = Array.from(element.attributes).some(attr => VALID_COMMAND_ATTRIBUTES.has(attr.name));
        if (!hasCommandAttribute) {
            const elementHTML = element.outerHTML.replace(/\s*\n\s*/g, " ").trim();
            throw new Error(`[server-commands] The following <htmx> tag has no command attributes and is therefore invalid:\n\n  ${elementHTML}\n`);
        }

        // Check unknown attributes
        for (const attr of element.attributes) {
            if (!VALID_COMMAND_ATTRIBUTES.has(attr.name)) {
                errors.push(
                    `Invalid attribute '${attr.name}'. Valid attributes are: ${[...VALID_COMMAND_ATTRIBUTES].join(', ')}`
                );
            }
        }

        // Check invalid combinations
        const hasSwapOrSelect = element.hasAttribute('swap') || element.hasAttribute('select');
        const hasTarget = element.hasAttribute('target');
        if (hasSwapOrSelect && !hasTarget) {
            errors.push(
                `A command with 'swap' or 'select' performs a swap and requires a target. Specify the target using the 'target' attribute: <htmx target="#my-div">...</htmx>`
            );
        }

        // If errors were found, throw an error with details
        if (errors.length > 0) {
            const elementHTML = element.outerHTML.replace(/\s*\n\s*/g, " ").trim();
            const errorIntro = `[server-commands] ${errors.length} validation error(s) for command:`;
            const errorDetails = errors.map(e => `  - ${e}`).join('\n');

            throw new Error(`${errorIntro}\n\n  ${elementHTML}\n\n${errorDetails}\n`);
        }
    }

    /**
     * Executes a trigger value (JSON or comma-separated events).
     * @param {{value: string}} trigger
     */
    function handleTriggerAttribute(trigger) {
        try {
            const triggers = JSON.parse(trigger.value);
            for (const eventName in triggers) {
                let detail = triggers[eventName];
                let target = document.body; // Default target

                if (typeof detail === 'object' && detail !== null && detail.target) {
                    const newTarget = htmx.find(detail.target);
                    if (newTarget) {
                        target = newTarget;
                    } else {
                        console.warn(`[server-commands] Trigger target "${detail.target}" not found.`);
                    }
                    delete detail.target; // Remove target from the detail payload
                }
                api.triggerEvent(target, eventName, detail);
            }
        } catch (e) {
            trigger.value.split(',').forEach(eventName => {
                api.triggerEvent(document.body, eventName.trim());
            });
        }
    }

    /**
     * Handles the location attribute, mimicking the HX-Location response header.
     * @param {string} redirectPath
     * A URL path or a JSON string with options for the htmx.ajax call.
     */
    function handleLocationAttribute(redirectPath) {
        let redirectSwapSpec = {};
        let path = redirectPath;

        // Check if the value is a JSON string to extract path and other options
        if (redirectPath.indexOf('{') === 0) {
            redirectSwapSpec = JSON.parse(redirectPath);
            path = redirectSwapSpec.path;
            delete redirectSwapSpec.path;
        }

        // Save current page to history before navigating away
        api.saveCurrentPageToHistory();

        // Make the AJAX request to fetch the new content.
        htmx.ajax('GET', path, api.mergeObjects({source: document.body}, redirectSwapSpec))
            .then(() => {
                // After content is loaded & swapped, push new URL to the history
                api.pushUrlIntoHistory(path);
            });
    }
})();