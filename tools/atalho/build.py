"""Builds the iOS Shortcut that sends photos to a person's upload link.

    python3 tools/atalho/build.py /tmp/unsigned.shortcut
    shortcuts sign --mode anyone --input /tmp/unsigned.shortcut --output /tmp/signed.shortcut
    cat /tmp/signed.shortcut > public/atalho/Cade-as-Fotos.shortcut

The last step copies the bytes on purpose: the file `shortcuts sign` writes was seen to disappear
from disk a few minutes later.
"""
import plistlib
import sys
import uuid

OBJECT_PLACEHOLDER = "￼"


def variable_text(name):
    attachment = {"Type": "Variable", "VariableName": name}
    return {"Value": {"string": OBJECT_PLACEHOLDER, "attachmentsByRange": {"{0, 1}": attachment}}, "WFSerializationType": "WFTextTokenString"}


def variable(name):
    return {"Value": {"Type": "Variable", "VariableName": name}, "WFSerializationType": "WFTextTokenAttachment"}


def output_of(action_uuid, name):
    return {"Value": {"OutputUUID": action_uuid, "Type": "ActionOutput", "OutputName": name}, "WFSerializationType": "WFTextTokenAttachment"}


def action(identifier, **parameters):
    return {"WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}", "WFWorkflowActionParameters": parameters}


loop, photos, link = (str(uuid.uuid4()).upper() for _ in range(3))
actions = [
    action("gettext", UUID=link, WFTextActionText="COLE_AQUI_O_LINK_DE_ENVIO"),
    action("setvariable", WFVariableName="Link", WFInput=output_of(link, "Texto")),
    action("selectphoto", UUID=photos, WFSelectMultiplePhotos=True),
    action("repeat.each", GroupingIdentifier=loop, WFControlFlowMode=0, WFInput=output_of(photos, "Fotos")),
    action("downloadurl", WFURL=variable_text("Link"), WFHTTPMethod="POST", WFHTTPBodyType="File", WFRequestVariable=variable("Repeat Item"), ShowHeaders=False),
    action("repeat.each", GroupingIdentifier=loop, WFControlFlowMode=2),
    action("notification", WFNotificationActionTitle="Cadê as Fotos?", WFNotificationActionBody="Envio terminado."),
]
workflow = {
    "WFWorkflowClientVersion": "2302.0.4",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowTypes": [],
    "WFWorkflowInputContentItemClasses": [],
    "WFWorkflowHasShortcutInputVariables": False,
    "WFWorkflowImportQuestions": [
        {
            "ActionIndex": 0,
            "Category": "Parameter",
            "ParameterKey": "WFTextActionText",
            "DefaultValue": "",
            "Text": "Cole o link de envio que o site Cadê as Fotos? mostra no seu grupo",
        }
    ],
    "WFWorkflowActions": actions,
}
with open(sys.argv[1], "wb") as out:
    plistlib.dump(workflow, out, fmt=plistlib.FMT_BINARY)
