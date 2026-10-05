# Privacy checklist for sites deploying agentlens

**This is not legal advice.** It lists what agentlens does and the questions a site deploying it should put to its own counsel. agentlens makes no legal claim, in particular none about whether its storage or processing is "strictly necessary" under the ePrivacy Directive or any national law.

## What agentlens does on the device

- Listens passively to pointer, keyboard, form, scroll and visibility events, and folds each event into counters and fixed-bin histograms as it arrives; the raw event is dropped at once.
- Runs one-shot probes (automation flags, user-agent and Client Hints coherence, media queries, a bucketed WebGL renderer class, screen geometry flags, a UTC offset in 15-minute steps) that each yield a bit or a small bucket, never the raw string.
- Checks for a few agent page markers by id or attribute.
- Never collects pointer coordinates, key values or codes, field values or lengths (beyond one "value grew by more than 3 characters" boolean), clipboard contents, element text, URLs, the raw user agent, the raw WebGL renderer, fonts or canvas. Password, card (`cc-*`) and one-time-code fields, `[data-al-ignore]` subtrees and your `ignore` selectors are not observed at all.
- Sets no cookies and makes no network request. The `features` object in each verdict is the complete record; the README's "data collected" table lists every field, generated from the schema a CI test enforces.
- Infers no disability. The cohort (`mouse`, `touch`, `keyboard`, `mixed`, `none`) comes from raw modality counts only.

## Storage, and the EU-cautious option

| `storage`                 | What is kept on the device                                                                                                    | Effect on results                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"session"` (the default) | `sessionStorage["al:v1"]` for the tab: the `features` counters, a random 128-bit session id, counters, the last label, 1-2 KB | A visit is judged across its pages                                                                                                                                        |
| `"memory"`                | Nothing; state lives in the page's memory and is gone when the page unloads                                                   | Each page is judged alone: no cross-page visit continuity, so short pages end `insufficient-data` or `abstain` more often. Signals, scoring and bundle size are unchanged |

**For an EU-facing site, `storage: "memory"` is the cautious choice.** It reads and writes nothing in browser storage. Whether reading and writing `sessionStorage` for this purpose needs consent under ePrivacy Art 5(3) is a question for your counsel; agentlens takes no position on it.

You can begin in memory mode and move to session storage once the visitor consents. That page then starts a new session:

```ts
let d = createDetector({ storage: "memory" });
onConsent(() => {
  d.destroy();
  d = createDetector({ storage: "session" });
});
```

A visitor sending Global Privacy Control already gets memory storage and minimal mode (no timing histograms, no input listeners), whichever option you set, unless you pass `respectGPC: false`.

## Questions for your counsel

1. **Storage consent.** Does reading and writing `sessionStorage` for agent detection need consent in your jurisdictions (ePrivacy Art 5(3) and national implementations), or is it covered by an exemption? If consent is needed, use `storage: "memory"`, or create the detector only after consent.
2. **Personal data.** Is a verdict (with its `features` and per-tab `sessionId`) personal data once you combine it with anything else you hold (an account, an IP address, an analytics id)? agentlens does not combine; your reporting code might.
3. **Biometric data.** Are timing histograms of keystrokes and clicks "biometric data" (GDPR Art 4(14) and Art 9) as you use them? They are coarse, binned and per session, and agentlens does not identify anyone, but the answer depends on your purpose and what you join them with.
4. **Lawful basis and purpose.** What is your basis for processing verdicts (for example legitimate interests in understanding automated traffic), and is the purpose limited to aggregate understanding? A behavioural verdict must not be used to deny anyone access: it is forgeable and its false-positive rate on assistive-technology users is not yet bounded.
5. **What you send, and where.** Which verdict fields leave the browser (the recipes send only the label, class, confidence and rule ids to analytics vendors unless you add `features`), to which processors, in which countries, kept for how long?
6. **Notice.** Does your privacy notice describe the collection? An Australian template follows; adapt it for other regimes.
7. **GPC and opt-outs.** Do you honour Global Privacy Control (agentlens does by default) and any other opt-out you offer?
8. **Retention and deletion.** How long are stored verdicts kept, and can you delete them on request? With session storage the browser discards the tab's state when the tab closes; `destroy({ clear: true })` erases it sooner.

## Australian Privacy Act: APP 1 and APP 5 notice template

Adapt the bracketed parts, and have your counsel check it against your APP privacy policy (APP 1) and the collection notice you give at or before collection (APP 5).

> **Automated traffic measurement.** [Site name] uses a script called agentlens to estimate how much of our traffic comes from automated software, such as AI agents and browser automation, rather than people. While you use [the site], the script counts how you interact with the page (for example how many clicks and key presses there are and how long they take) in your browser. It does not record what you type, where you click, the text of the page or the addresses you visit, and it does not set cookies. [It keeps these counts in your browser tab's session storage, which is cleared when you close the tab. / It keeps nothing in your browser after you leave a page.]
>
> The script produces a summary label such as "human-like" or "agent-likely". [We send that label, and the counts it is based on, to [our servers / analytics provider name] in [country]] [We do not send it anywhere]. We use it only to understand our traffic in aggregate, never to decide whether you may use [the site]. [We keep it for [period].]
>
> If your browser sends a Global Privacy Control signal, the script collects only a few technical facts about the browser and no interaction counts. You can ask us about, access or correct personal information we hold, or complain about how we handle it, by contacting [contact]. Our privacy policy at [link] explains how we handle complaints and whether we disclose information overseas.

## Harness participants

People who record sessions on the eval harness give consent with [harness/human/consent.md](../harness/human/consent.md), are identified only by a pseudonym (P01, P02, ...), and can have their sessions deleted on request. That is the project's own obligation, separate from any site's.
