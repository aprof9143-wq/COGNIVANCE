"""NIMBLE platform core — the scientific stack behind Cognivance Labs.

Layered by responsibility. A modality library stays inside its own modality
package: nibabel/nilearn only under `imaging/`, mne only under `eeg/`. Anything
downstream of those sees `UnifiedNeuralRecord` and nothing else.
"""

__version__ = "0.1.0"
