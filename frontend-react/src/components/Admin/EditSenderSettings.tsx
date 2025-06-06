import { Button, Grid, GridContainer } from "@trussworks/react-uswds";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useController, useResource } from "rest-hooks";

import {
    CheckboxComponent,
    DropdownComponent,
    TextAreaComponent,
    TextInputComponent,
} from "./AdminFormEdit";
import { AdminFormWrapper } from "./AdminFormWrapper";
import {
    ConfirmSaveSettingModal,
    ConfirmSaveSettingModalRef,
} from "./CompareJsonModal";
import Title from "../../components/Title";
import config from "../../config";
import useSessionContext from "../../contexts/Session/useSessionContext";
import { useToast } from "../../contexts/Toast";
import useAppInsightsContext from "../../hooks/UseAppInsightsContext/UseAppInsightsContext";
import OrgSenderSettingsResource from "../../resources/OrgSenderSettingsResource";
import { jsonSortReplacer } from "../../utils/JsonSortReplacer";
import {
    getErrorDetailFromResponse,
    getVersionWarning,
    isValidServiceName,
    VersionWarningType,
} from "../../utils/misc";
import { SampleKeysObj } from "../../utils/TemporarySettingsAPITypes";
import { ModalConfirmDialog, ModalConfirmRef } from "../ModalConfirmDialog";
import { ObjectTooltip } from "../tooltips/ObjectTooltip";

const { RS_API_URL } = config;

interface EditSenderSettingsFormProps {
    orgname: string;
    sendername: string;
    action: "edit" | "clone";
}
const EditSenderSettingsForm = ({
    orgname,
    sendername,
    action,
}: EditSenderSettingsFormProps) => {
    const { toast: showAlertNotification } = useToast();
    const { properties } = useAppInsightsContext();
    const navigate = useNavigate();
    const confirmModalRef = useRef<ConfirmSaveSettingModalRef>(null);
    const { activeMembership, authState, rsConsole } = useSessionContext();

    const orgSenderSettings: OrgSenderSettingsResource = useResource(
        OrgSenderSettingsResource.detail(),
        { orgname, sendername: sendername },
    );

    const [orgSenderSettingsOldJson, setOrgSenderSettingsOldJson] =
        useState("");
    const [orgSenderSettingsNewJson, setOrgSenderSettingsNewJson] =
        useState("");
    const { fetch: fetchController } = useController();
    const { invalidate } = useController();
    const [loading, setLoading] = useState(false);

    const modalRef = useRef<ModalConfirmRef>(null);
    const ShowDeleteConfirm = (deleteItemId: string) => {
        modalRef?.current?.showModal({
            title: "Confirm Delete",
            message:
                "Deleting a setting will only mark it deleted. It can be accessed via the revision history",
            okButtonText: "Delete",
            itemId: deleteItemId,
        });
    };
    const doDelete = async (deleteItemId: string) => {
        try {
            await fetchController(OrgSenderSettingsResource.deleteSetting(), {
                orgname: orgname,
                sendername: deleteItemId,
            });

            showAlertNotification(
                `Item '${deleteItemId}' has been deleted`,
                "success",
            );

            // navigate back to list since this item was just deleted
            navigate(-1);
            return true;
        } catch (e: any) {
            rsConsole.trace(e);
            showAlertNotification(
                new Error(
                    `Deleting item '${deleteItemId}' failed. ${e.toString()}`,
                    { cause: e },
                ),
                "error",
            );
            return false;
        }
    };

    async function getLatestSenderResponse() {
        const accessToken = authState.accessToken?.accessToken;
        const organization = activeMembership?.parsedName;

        const response = await fetch(
            `${RS_API_URL}/api/settings/organizations/${orgname}/senders/${sendername}`,
            {
                headers: {
                    "x-ms-session-id": properties.context.getSessionId(),
                    Authorization: `Bearer ${accessToken}`,
                    Organization: organization!,
                },
            },
        );

        return await response.json();
    }

    const ShowCompareConfirm = async () => {
        try {
            const { name } = orgSenderSettings;

            if (!isValidServiceName(name)) {
                showAlertNotification(
                    `${name} cannot contain special characters.`,
                    "error",
                );
                return false;
            }

            // fetch original version
            setLoading(true);
            const latestResponse = await getLatestSenderResponse();
            setOrgSenderSettingsOldJson(
                JSON.stringify(latestResponse, jsonSortReplacer, 2),
            );
            setOrgSenderSettingsNewJson(
                JSON.stringify(orgSenderSettings, jsonSortReplacer, 2),
            );

            if (
                action === "edit" &&
                latestResponse?.version !== orgSenderSettings?.version
            ) {
                showAlertNotification(
                    getVersionWarning(VersionWarningType.POPUP),
                    "error",
                );
                confirmModalRef?.current?.setWarning(
                    getVersionWarning(VersionWarningType.FULL, latestResponse),
                );
                confirmModalRef?.current?.disableSave();
            }

            confirmModalRef?.current?.showModal();
            setLoading(false);
        } catch (e: any) {
            setLoading(false);
            const errorDetail = await getErrorDetailFromResponse(e);
            rsConsole.trace(e, errorDetail);
            showAlertNotification(
                new Error(
                    `Reloading sender '${sendername}' failed with: ${errorDetail}`,
                    { cause: e },
                ),
                "error",
            );
            return false;
        }
    };

    async function resetSenderList() {
        await invalidate(OrgSenderSettingsResource.list(), {
            orgname,
            sendername: sendername,
        });

        return true;
    }

    const saveSenderData = async () => {
        try {
            setLoading(true);
            const latestResponse = await getLatestSenderResponse();
            if (latestResponse.version !== orgSenderSettings?.version) {
                // refresh left-side panel in compare modal to make it obvious what has changed
                setOrgSenderSettingsOldJson(
                    JSON.stringify(latestResponse, jsonSortReplacer, 2),
                );
                showAlertNotification(
                    getVersionWarning(VersionWarningType.POPUP),
                    "error",
                );
                confirmModalRef?.current?.setWarning(
                    getVersionWarning(VersionWarningType.FULL, latestResponse),
                );
                confirmModalRef?.current?.disableSave();
                return false;
            }

            const data = confirmModalRef?.current?.getEditedText();

            const sendernamelocal =
                action === "clone" ? orgSenderSettings.name : sendername;

            await fetchController(
                // NOTE: For 'clone' does not use the expected OrgSenderSettingsResource.create() method
                // due to the endpoint being an 'upsert' (PUT) instead of the expected 'insert' (POST)
                OrgSenderSettingsResource.update(),
                { orgname, sendername: sendernamelocal },
                data,
            );

            showAlertNotification(
                `Item '${sendernamelocal}' has been saved`,
                "success",
            );
            confirmModalRef?.current?.toggleModal(undefined, false);
            setLoading(false);
            navigate(-1);
        } catch (e: any) {
            setLoading(false);
            const errorDetail = await getErrorDetailFromResponse(e);
            rsConsole.trace(e, errorDetail);
            showAlertNotification(
                new Error(
                    `Updating sender '${sendername}' failed with: ${errorDetail}`,
                    { cause: e },
                ),
                "error",
            );
            return false;
        }
        return true;
    };

    return (
        <section className="grid-container margin-top-0">
            <GridContainer>
                <TextInputComponent
                    fieldname={"name"}
                    label={"Name"}
                    defaultvalue={
                        action === "edit" ? orgSenderSettings.name : ""
                    }
                    savefunc={(v) => (orgSenderSettings.name = v)}
                    disabled={action === "edit"}
                />
                <DropdownComponent
                    fieldname={"format"}
                    label={"Format"}
                    defaultvalue={orgSenderSettings.format}
                    savefunc={(v) => (orgSenderSettings.format = v)}
                    valuesFrom={"format"}
                />
                <TextInputComponent
                    fieldname={"topic"}
                    label={"Topic"}
                    defaultvalue={orgSenderSettings.topic}
                    savefunc={(v) => (orgSenderSettings.topic = v)}
                />
                <DropdownComponent
                    fieldname={"customerStatus"}
                    label={"Customer Status"}
                    defaultvalue={orgSenderSettings.customerStatus}
                    savefunc={(v) => (orgSenderSettings.customerStatus = v)}
                    valuesFrom={"customerStatus"}
                />
                <TextInputComponent
                    fieldname={"schemaName"}
                    label={"Schema Name"}
                    defaultvalue={orgSenderSettings.schemaName}
                    savefunc={(v) => (orgSenderSettings.schemaName = v)}
                />
                <TextAreaComponent
                    fieldname={"keys"}
                    label={"Keys"}
                    toolTip={<ObjectTooltip obj={new SampleKeysObj()} />}
                    defaultvalue={orgSenderSettings.keys}
                    defaultnullvalue={""}
                    savefunc={(v) => (orgSenderSettings.keys = v)}
                />
                <DropdownComponent
                    fieldname={"processingType"}
                    label={"Processing Type"}
                    defaultvalue={orgSenderSettings.processingType}
                    savefunc={(v) => (orgSenderSettings.processingType = v)}
                    valuesFrom={"processingType"}
                />
                <CheckboxComponent
                    fieldname="allowDuplicates"
                    label="Allow Duplicates"
                    defaultvalue={orgSenderSettings.allowDuplicates}
                    savefunc={(v) => (orgSenderSettings.allowDuplicates = v)}
                />
                <Grid row className="margin-top-2">
                    <Grid col={6}>
                        {action === "edit" ? (
                            <Button
                                type={"button"}
                                secondary={true}
                                data-testid={"senderSettingDeleteButton"}
                                onClick={() => ShowDeleteConfirm(sendername)}
                            >
                                Delete...
                            </Button>
                        ) : null}
                    </Grid>
                    <Grid col={6} className={"text-right"}>
                        <Button
                            type="button"
                            onClick={() =>
                                void resetSenderList().then(() => navigate(-1))
                            }
                        >
                            Cancel
                        </Button>
                        <Button
                            form="edit-setting"
                            type="submit"
                            data-testid="submit"
                            disabled={loading}
                            onClick={() => void ShowCompareConfirm()}
                        >
                            Edit json and save...
                        </Button>
                    </Grid>
                </Grid>
                <ConfirmSaveSettingModal
                    uniquid={
                        action === "edit" ? sendername : orgSenderSettings.name
                    }
                    onConfirm={() => void saveSenderData()}
                    ref={confirmModalRef}
                    oldjson={orgSenderSettingsOldJson}
                    newjson={orgSenderSettingsNewJson}
                />
            </GridContainer>
            <ModalConfirmDialog
                id={"deleteConfirm"}
                onConfirm={(id) => void doDelete(id)}
                ref={modalRef}
            ></ModalConfirmDialog>
        </section>
    );
};

export interface EditSenderSettingsProps {
    orgname: string;
    sendername: string;
    action: "edit" | "clone";
    [k: string]: string | undefined;
}

export function EditSenderSettingsPage() {
    const { orgname, sendername, action } =
        useParams<EditSenderSettingsProps>();

    return (
        <AdminFormWrapper
            header={
                <Title
                    preTitle={`Org name: ${orgname}`}
                    title={`Sender name: ${sendername}`}
                />
            }
        >
            <EditSenderSettingsForm
                orgname={orgname ?? ""}
                sendername={sendername ?? ""}
                action={action ?? "edit"}
            />
        </AdminFormWrapper>
    );
}

export default EditSenderSettingsPage;
